import { analyticsServer } from "@/lib/analyticsRuntime";
import {
  getGeneralTools as generalGetTools,
  dispatchGeneralAction,
  onSessionEnd as generalOnSessionEnd,
} from "@ginkgo/app-general/server";
import {
  getDesignTools as designGetTools,
  dispatchDesignAction,
  DesignService,
  checkDesignHealth,
} from "@ginkgo/app-design/server";
import { appRegistry } from "./registry";
import type { AppServerContract } from "@ginkgo/app-sdk";

/**
 * 运行时服务端解析（宿主组合根统一出口）：
 * 需要运行时依赖注入的应用返回组合根装配的实例——analytics 为数据源单例/产物
 * 服务工厂；general 为 `./server` 入口的沙箱工具装配（实现含 Node 内置模块，
 * 必须与客户端 bundle 隔离，不进应用包主入口）。其余应用返回静态包契约
 * （app.server）。此处的 appId 装配属于组合根职责，不属于平台编排层的领域耦合。
 */
export function resolveRuntimeServer(appId: string):
  | (AppServerContract & {
      refreshArtifact?: AppServerContract["refreshArtifact"];
    })
  | undefined {
  if (appId === "analytics") {
    return analyticsServer as unknown as AppServerContract;
  }
  // 执行路径只认启用应用：停用后不得再返回工具/动作实现
  const staticContract = appRegistry.getEnabled(appId)?.server;
  if (appId === "general") {
    // 组合根注入运行时实现：静态声明段（needsWorkspace 等）+ ./server 入口的工具装配与动作分发
    return {
      ...staticContract,
      getTools: generalGetTools,
      dispatchAction: dispatchGeneralAction,
      onSessionEnd: generalOnSessionEnd,
    };
  }
  if (appId === "design") {
    return {
      ...staticContract,
      getTools: designGetTools,
      dispatchAction: dispatchDesignAction,
      // 外部 CLI 依赖由应用自治探测（宿主不持有"能力→命令"映射）
      healthCheck: checkDesignHealth,
      listArtifacts: async (ctx) => DesignService.listArtifacts(ctx.sandboxDir),
    };
  }
  return staticContract;
}
