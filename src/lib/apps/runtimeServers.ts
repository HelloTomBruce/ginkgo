import { analyticsServer } from "@/lib/analyticsRuntime";
import { appRegistry } from "./registry";
import type { AppServerContract } from "@openui-analytics/app-sdk";

/**
 * 运行时服务端解析（宿主组合根统一出口）：
 * 需要依赖注入的应用（analytics：数据源单例/产物服务）返回组合根装配的工厂实例，
 * 其余应用返回静态包契约（app.server）。此处的 appId 特判属于组合根装配，
 * 不属于平台编排层的领域耦合。
 */
export function resolveRuntimeServer(appId: string):
  | (AppServerContract & {
      refreshArtifact?: AppServerContract["refreshArtifact"];
    })
  | undefined {
  if (appId === "analytics") {
    return analyticsServer as unknown as AppServerContract;
  }
  return appRegistry.get(appId)?.server;
}
