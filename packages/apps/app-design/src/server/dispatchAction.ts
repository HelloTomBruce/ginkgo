import type { AppActionContext } from "@ginkgo/app-sdk";
import { DesignService } from "./designService";

/**
 * 体验设计工坊自治动作分发器（RPC 处理入口）
 * 供平台通用网关 POST /api/apps/design/action 消费
 *
 * 安全线约束：所有动作的工作目录一律取 ctx.workspaceDir
 * （由网关经 sessionId 归一化解析的可信沙箱路径），
 * 不接受任何客户端透传的文件系统路径（防 Path Traversal）。
 */
export async function dispatchDesignAction(
  action: string,
  payload: Record<string, unknown>,
  ctx: AppActionContext
): Promise<unknown> {
  const workspaceDir = ctx.workspaceDir;

  switch (action) {
    case "status": {
      return await DesignService.getStatus(workspaceDir);
    }
    case "artifacts": {
      return await DesignService.listArtifacts(workspaceDir);
    }
    case "serve": {
      return await DesignService.serve(workspaceDir);
    }
    case "stop": {
      return await DesignService.stop(workspaceDir);
    }
    case "serve_system": {
      return await DesignService.serveSystem(workspaceDir);
    }
    case "stop_system": {
      return await DesignService.stopSystem(workspaceDir);
    }
    case "audit": {
      return await DesignService.audit(workspaceDir);
    }
    default: {
      throw new Error(`Unknown design action: ${action}`);
    }
  }
}
