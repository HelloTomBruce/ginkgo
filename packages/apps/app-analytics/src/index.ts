import type { AppPackageDefinition } from "@ginkgo/app-sdk";
import { analyticsManifest, analyticsClient } from "./manifest";

/**
 * analytics 应用静态包定义。
 *
 * 服务端能力（System Prompt 三模式分发 / 数据源与跨源工具装配 / plan→execute
 * 方法卡交接）依赖运行时单例（datasources 等），不在静态导出上提供——
 * 由宿主组合根经 createAnalyticsServer(deps) 工厂装配（见 src/server/index.ts）。
 */
export const analyticsAppPackage: AppPackageDefinition = {
  manifest: analyticsManifest,
  client: analyticsClient,
  server: {
    requiresDataTools: true,
    requiredCapabilities: ["sql_query", "chart_spec", "methodology"],
  },
};

export default analyticsAppPackage;
export * from "./manifest";
export * from "./client";
// 服务端能力仅经 "./server" 子路径访问（宿主 API 路由/组合根）：
// 根入口被客户端组件链（appRegistry → ChatDashboard）引用，不得引入
// server 模块（其 datasources 依赖含 DuckDB 原生绑定，会打进浏览器包）。
