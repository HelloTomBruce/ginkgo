import { CliBridge } from "./cliBridge";

export interface DesignStatusResponse {
  hasCanvas: boolean;
  canvasTitle?: string;
  boardCount: number;
  boards: string[];
  previewUrl?: string;
  hasDesignSystem: boolean;
  designSystem?: Record<string, unknown>;
  checkResult?: {
    problems: number;
    issues?: Array<{ file: string; message: string }>;
  };
}

export class DesignService {
  /**
   * 获取工作区设计资产状态（供 API 路由消费）
   */
  static async getStatus(workspaceDir: string): Promise<DesignStatusResponse> {
    const meta = await CliBridge.getWorkspaceDesignMeta(workspaceDir);
    let checkResult: DesignStatusResponse["checkResult"] = undefined;
    let previewUrl: string | undefined;

    if (meta.hasCanvas) {
      const check = await CliBridge.checkCanvas(workspaceDir);
      checkResult = {
        problems: check.problems,
        issues: check.issues,
      };

      // 尝试启动或获取现有服务的 url
      const serveRes = await CliBridge.serveCanvas(workspaceDir);
      if (serveRes.url) {
        previewUrl = serveRes.url;
      }
    }

    return {
      hasCanvas: meta.hasCanvas,
      canvasTitle: typeof meta.canvasJson?.title === "string" ? meta.canvasJson.title : undefined,
      boardCount: meta.boards.length,
      boards: meta.boards,
      previewUrl,
      hasDesignSystem: meta.hasDesignSystem,
      designSystem: meta.designSystemJson,
      checkResult,
    };
  }

  /**
   * 手动控制画板服务
   */
  static async serve(workspaceDir: string) {
    return CliBridge.serveCanvas(workspaceDir);
  }

  static async stop(workspaceDir: string) {
    return CliBridge.stopCanvas(workspaceDir);
  }

  /**
   * 触发设计系统代码审查
   */
  static async audit(targetDir: string) {
    return CliBridge.auditDesignSystem(targetDir);
  }
}
