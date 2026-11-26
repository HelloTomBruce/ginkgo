import path from "node:path";

/**
 * 应用包侧存储根解析（服务端专用）。
 *
 * 应用包**禁止** import 宿主模块，因此经环境变量契约与宿主对齐：
 *   1. `GINKGO_HOME` / `GINKGO_DATA_DIR`：用户显式配置
 *   2. `GINKGO_RESOLVED_HOME`：宿主 `src/lib/storagePaths.ts` 解析后下发
 *      （覆盖「既有本地 ./data 沿用」与「全新安装落 ~/.ginkgo」两种判定）
 *   3. 均未设置时退回 `process.cwd()`——保持应用包被独立使用时（含测试）的历史行为
 *
 * 之所以惰性求值：`dashboardStore` 等模块级单例可能在宿主完成引导前就被 import，
 * 模块加载期固化路径会重新引入「宿主搬到新根、包内仍写 cwd」的分裂存储。
 */
export function resolveAnalyticsStorageRoot(): string {
  const explicit =
    process.env.GINKGO_HOME?.trim() || process.env.GINKGO_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);

  const resolved = process.env.GINKGO_RESOLVED_HOME?.trim();
  if (resolved) return path.resolve(resolved);

  return process.cwd();
}

export interface AnalyticsStorageDirs {
  root: string;
  dataDir: string;
  configDir: string;
  dashboardsDir: string;
  methodologyDir: string;
  crossSourceMapPath: string;
  certifiedQueriesPath: string;
}

export function resolveAnalyticsStorageDirs(): AnalyticsStorageDirs {
  const root = resolveAnalyticsStorageRoot();
  return {
    root,
    dataDir: path.join(root, "data"),
    configDir: path.join(root, "config"),
    dashboardsDir: path.join(root, "data", "dashboards"),
    methodologyDir: path.join(root, "data", "methodology"),
    crossSourceMapPath: path.join(root, "config", "cross-source-map.json"),
    certifiedQueriesPath: path.join(root, "config", "certified-queries.json"),
  };
}
