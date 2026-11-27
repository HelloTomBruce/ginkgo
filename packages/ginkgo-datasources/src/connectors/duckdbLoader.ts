/**
 * DuckDB 运行时懒加载。
 *
 * 为什么不在模块顶层 `import { DuckDBInstance } from "@duckdb/node-api"`：
 * @duckdb/node-api 依赖平台原生二进制（`@duckdb/node-bindings-<platform>`，
 * 经 optionalDependencies 按平台分发）。当该二进制缺失时——用户以
 * `npm i --omit=optional` 安装、网络失败、或平台无预编译包——顶层 import
 * 会让整个模块图加载失败，进而拖垮**所有** /api 路由（实测 /api/apps 与
 * /api/datasources 全 500，首页 200）。一个可选数据源不该让服务半残。
 *
 * 改为懒加载后：缺失只在真正使用 DuckDB 能力（文件数据源、duckdb 方言）
 * 时抛出可识别的错误，其余数据源与页面正常工作。
 */

/** DuckDB 原生二进制不可用（可被上层捕获并降级，不应扩散为全站 500） */
export class DuckDBNativeUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "DuckDB 原生模块不可用：未找到当前平台的 @duckdb/node-bindings 二进制。" +
        "请确认安装时未使用 --omit=optional（或 --no-optional），" +
        "且当前平台存在预编译包；DuckDB 相关功能（文件数据源、duckdb 方言）暂不可用，" +
        "其它数据源不受影响。",
      options
    );
    this.name = "DuckDBNativeUnavailableError";
  }
}

type DuckDBApi = typeof import("@duckdb/node-api");

let cached: DuckDBApi | null = null;

/**
 * 懒加载 @duckdb/node-api；原生二进制缺失时抛 DuckDBNativeUnavailableError。
 *
 * 为什么用 createRequire + 运行时拼接模块名，而不是 `await import("@duckdb/node-api")`：
 * Turbopack 会把**字面量** dynamic import 提升成 chunk 顶层的 external 依赖
 * （编译产物形如 `e.x("@duckdb/node-api-<hash>", () => require(...))`，在该模块
 * 初始化时即执行）。那样原生二进制缺失仍会让整个模块图加载失败，懒加载形同虚设
 * —— 实测 --omit=optional 安装后 /api/* 依旧 500。拼接后的说明符无法被静态分析，
 * 才真正延迟到首次使用时加载。
 */
export async function loadDuckDBApi(): Promise<DuckDBApi> {
  if (cached) return cached;
  try {
    const { createRequire } = await import("node:module");
    const runtimeRequire = createRequire(import.meta.url);
    // 运行时拼接：刻意避免打包器的静态分析
    const specifier = ["@duckdb", "node-api"].join("/");
    cached = runtimeRequire(specifier) as DuckDBApi;
    return cached;
  } catch (err) {
    throw new DuckDBNativeUnavailableError({ cause: err });
  }
}

/** 探测 DuckDB 是否可用（供能力宣称/诊断使用，不抛错） */
export async function isDuckDBAvailable(): Promise<boolean> {
  try {
    await loadDuckDBApi();
    return true;
  } catch {
    return false;
  }
}
