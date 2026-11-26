import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getStoragePath, writeJsonAtomic } from "@/lib/storagePaths";
import type { AppConfigFile } from "./registry";
import initialAppsConfig from "../../../config/apps.json";

/**
 * 应用清单持久化（`<root>/config/apps.json`）。
 *
 * 事实来源契约：磁盘文件是唯一事实来源；打包进 bundle 的 `config/apps.json`
 * 只在「文件尚不存在」（首次运行）时作为初始值。
 *
 * 损坏处理契约（与旧实现的关键差异）：解析失败**不再**静默回落到初始配置。
 * 静默回落 + 随后的保存会永久覆盖用户配置，属数据丢失级缺陷。现在的行为是
 * 备份为 `apps.json.corrupt-<ts>` 后抛出 `AppsConfigCorruptError`：
 *   - 读路径（GET /api/apps）捕获后降级展示初始配置并附带告警；
 *   - 写路径（安装/启停/卸载）直接失败，绝不覆盖。
 */

export class AppsConfigCorruptError extends Error {
  constructor(
    readonly filePath: string,
    readonly backupPath: string | null,
    cause: unknown
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`应用配置已损坏，未做任何覆盖写入：${filePath}（${detail}）`);
    this.name = "AppsConfigCorruptError";
  }
}

/** 配置文件的绝对路径 */
export function getAppsConfigFile(): string {
  return getStoragePath("config", "apps.json");
}

function isAppConfigFile(value: unknown): value is AppConfigFile {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as AppConfigFile).apps)
  );
}

/**
 * 读取应用配置。
 *
 * @throws AppsConfigCorruptError 文件存在但无法解析/形态非法
 */
export async function loadAppsConfig(): Promise<AppConfigFile> {
  const configPath = getAppsConfigFile();

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // 首次运行：以打包内声明为初始值（尚未落盘）
      return initialAppsConfig as AppConfigFile;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AppsConfigCorruptError(
      configPath,
      await backupCorruptFile(configPath, raw),
      err
    );
  }

  if (!isAppConfigFile(parsed)) {
    throw new AppsConfigCorruptError(
      configPath,
      await backupCorruptFile(configPath, raw),
      new Error("形态非法：缺少 apps 数组")
    );
  }

  return parsed;
}

/**
 * 读取应用配置，损坏时降级为初始配置并返回告警（只读展示路径专用）。
 */
export async function loadAppsConfigWithFallback(): Promise<{
  config: AppConfigFile;
  warning?: string;
}> {
  try {
    return { config: await loadAppsConfig() };
  } catch (err) {
    if (err instanceof AppsConfigCorruptError) {
      return {
        config: initialAppsConfig as AppConfigFile,
        warning: err.message,
      };
    }
    throw err;
  }
}

/**
 * 损坏现场备份路径（进程内按文件记忆 + **内容哈希**命名）。
 *
 * 两层去重都是必要的：
 *   1. 进程内记忆：`loadAppsConfigWithFallback` 会在启动引导与每个 GET 请求里被调用，
 *      若每次都新建 `.corrupt-<ts>`，一个坏文件会让配置目录无限堆积备份；
 *   2. 内容哈希命名：Next 的 instrumentation 与路由 handler 是两套模块图，
 *      各自持有一份模块级缓存 —— 用哈希命名让两份缓存在同一份坏内容上落到同一个文件。
 */
const corruptBackupCache = new Map<string, string | null>();

/** 测试专用：清空备份路径记忆（模拟另一套模块图） */
export function resetCorruptBackupCacheForTesting(): void {
  corruptBackupCache.clear();
}

/** 保留损坏文件现场（不覆盖、不删除），返回备份路径 */
async function backupCorruptFile(
  configPath: string,
  rawContent: string
): Promise<string | null> {
  const cacheKey = `${configPath}::${rawContent.length}`;
  if (corruptBackupCache.has(cacheKey)) {
    return corruptBackupCache.get(cacheKey) ?? null;
  }

  const digest = crypto
    .createHash("sha1")
    .update(rawContent)
    .digest("hex")
    .slice(0, 8);
  const backupPath = `${configPath}.corrupt-${digest}`;

  let result: string | null = backupPath;
  try {
    // 已存在说明同一份坏内容已备份过（另一模块图或上一轮），无需重复写
    await fs.access(backupPath);
  } catch {
    try {
      await fs.copyFile(configPath, backupPath);
    } catch {
      result = null;
    }
  }

  corruptBackupCache.set(cacheKey, result);
  return result;
}

/** 原子写应用配置 */
export async function saveAppsConfig(config: AppConfigFile): Promise<void> {
  await writeJsonAtomic(getAppsConfigFile(), config);
}

// ========== 进程内互斥：避免并发 read-modify-write 丢更新 ==========

let lockChain: Promise<unknown> = Promise.resolve();

/**
 * 串行化应用配置的读-改-写。
 *
 * 场景：两次并发 toggle 各自读到旧值再写回，后写者覆盖先写者。进程内单机形态
 * 下用 Promise 链即可；多副本部署需换成 file lock / 外部存储（与 LLM 台账同理）。
 */
export async function withAppsConfigLock<T>(
  fn: () => Promise<T>
): Promise<T> {
  const run = lockChain.then(fn, fn);
  // 保持链条不因单次失败断裂
  lockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** 单次读-改-写（带锁）：把「读 → 变 → 写」收敛成一个原子事务 */
export async function mutateAppsConfig(
  mutate: (config: AppConfigFile) => void | Promise<void>
): Promise<AppConfigFile> {
  return withAppsConfigLock(async () => {
    const config = await loadAppsConfig();
    await mutate(config);
    await saveAppsConfig(config);
    return config;
  });
}

/** 路径辅助：供测试与诊断展示 */
export function describeAppsConfigPath(): string {
  return path.resolve(getAppsConfigFile());
}
