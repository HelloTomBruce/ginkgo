import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * 统一存储根解析（宿主侧唯一实现）。
 *
 * 解析优先级（**默认零变更**是首要约束：升级后既有安装不得搬家）：
 *   1. `GINKGO_HOME`（显式指定，最高优先）
 *   2. `GINKGO_DATA_DIR`（旧变量名，兼容）
 *   3. 既有本地布局：`./data` 或 `./config` 任一存在 → 沿用 `process.cwd()`
 *   4. 全新安装：`~/.ginkgo`（Windows 回退 `USERPROFILE` / `HOMEPATH`）
 *
 * 为什么不再判定 `NODE_ENV`：历史实现把「源码开发模式」绑定到 NODE_ENV，
 * 导致 `pnpm start` / Docker / 打包运行时**静默**把数据根切到 `~/.ginkgo`，
 * 既有 `./data` 凭空不可见。是否搬家只应由「显式配置」或「本地是否已有数据」决定。
 */

export type StorageCategory = "config" | "data" | "plugins" | "logs";

let cachedHome: string | null = null;

function pathExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

/** 指定目录是否已存在历史数据布局（`./data` 或 `./config`） */
export function hasLegacyLocalStorage(cwd: string = process.cwd()): boolean {
  return (
    pathExists(path.join(cwd, "data")) || pathExists(path.join(cwd, "config"))
  );
}

/**
 * 存储根解析的**纯函数**实现（无副作用、无缓存）。
 *
 * 抽成纯函数是为了让分支（显式配置 / 历史布局 / 全新安装）可被单测穷举，
 * 不必 `process.chdir` 或依赖仓库当前状态。
 */
export function resolveGinkgoHomeDir(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): string {
  const explicit = env.GINKGO_HOME?.trim() || env.GINKGO_DATA_DIR?.trim();
  if (explicit) return path.resolve(cwd, explicit);

  // 历史布局优先于主目录：升级既有安装不得搬家
  if (hasLegacyLocalStorage(cwd)) return cwd;

  const home = env.HOME || env.USERPROFILE || env.HOMEPATH || cwd;
  return path.join(home, ".ginkgo");
}

/**
 * 获取 Ginkgo 统一数据与配置根目录（进程内缓存）。
 *
 * 副作用（有意为之）：解析结果写入 `GINKGO_RESOLVED_HOME`。能力包与应用包
 * 禁止 import 宿主模块，它们统一从该环境变量读取同一存储根，避免「宿主搬到
 * 新根、包内仍写 cwd」的分裂存储。
 */
export function getGinkgoHomeDir(): string {
  if (cachedHome) return cachedHome;

  cachedHome = resolveGinkgoHomeDir(process.env, process.cwd());
  process.env.GINKGO_RESOLVED_HOME = cachedHome;
  return cachedHome;
}

/** 测试专用：清除根目录缓存（环境变量在用例间切换时必须调用） */
export function resetStorageRootCacheForTesting(): void {
  cachedHome = null;
  delete process.env.GINKGO_RESOLVED_HOME;
}

/** 获取指定类别的存储物理绝对路径 */
export function getStoragePath(
  category: StorageCategory,
  ...subPaths: string[]
): string {
  return path.join(getGinkgoHomeDir(), category, ...subPaths);
}

/** 会话存储目录：`<root>/data/sessions` */
export function getSessionStorageDir(): string {
  return getStoragePath("data", "sessions");
}

/** 看板存储目录：`<root>/data/dashboards` */
export function getDashboardStorageDir(): string {
  return getStoragePath("data", "dashboards");
}

/** 工作区记录文件：`<root>/data/workspaces/_workspaces.json` */
export function getWorkspaceStorageFile(): string {
  return getStoragePath("data", "workspaces", "_workspaces.json");
}

/** 工作区沙箱根目录：`<root>/data/workspaces` */
export function getWorkspacesRootDir(): string {
  return getStoragePath("data", "workspaces");
}

/** 用户上传文件与 DuckDB 存储目录：`<root>/data/files` */
export function getFileStorageDir(): string {
  return getStoragePath("data", "files");
}

/** 配置文件目录：`<root>/config` */
export function getConfigDir(): string {
  return getStoragePath("config");
}

/** 动态插件安装目录：`<root>/plugins` */
export function getPluginsDir(): string {
  return getStoragePath("plugins");
}

/** MCP server 配置：`<root>/config/mcp-servers.json` */
export function getMcpServersFile(): string {
  return getStoragePath("config", "mcp-servers.json");
}

/** 数据源配置：`<root>/config/datasources.json` */
export function getDatasourcesConfigFile(): string {
  return getStoragePath("config", "datasources.json");
}

/** 模型单价表：`<root>/config/model-pricing.json` */
export function getModelPricingFile(): string {
  return getStoragePath("config", "model-pricing.json");
}

/** tokenizer 映射表：`<root>/config/model-tokenizer.json` */
export function getTokenizerConfigFile(): string {
  return getStoragePath("config", "model-tokenizer.json");
}

/**
 * 原子写 JSON：临时文件 → `fsync` → rename。
 *
 * 崩溃安全：rename 前绝不触碰目标文件；掉电最坏丢本次更新，不会留下半截 JSON。
 * 与 `sessionStore` 既有约定一致，配置类存储也应走这条路径。
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown
): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  const payload =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 10)}`;

  const handle = await fsp.open(tmpPath, "w");
  try {
    await handle.writeFile(payload, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
