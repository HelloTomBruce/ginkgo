import type { AppArtifactItem } from "@ginkgo/app-sdk";
import { CliBridge, type BoardDetail, type DashboardArtifact } from "./cliBridge";

export interface DesignStatusResponse {
  hasCanvas: boolean;
  canvasTitle?: string;
  boardCount: number;
  boards: string[];
  boardsDetail?: BoardDetail[];
  dashboards?: DashboardArtifact[];
  hasClaudeData?: boolean;
  previewUrl?: string;
  systemPreviewUrl?: string;
  workspacePath?: string;
  hasDesignSystem: boolean;
  designSystem?: Record<string, unknown>;
  checkResult?: {
    problems: number;
    issues?: Array<{ file: string; message: string }>;
  };
}

export class DesignService {
  /**
   * 获取工作区设计资产状态（供 API 路由与 dispatchAction 消费）
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

    let systemPreviewUrl: string | undefined;
    if (meta.hasDesignSystem) {
      // 尝试启动或获取现有 Design System 编辑器服务的 url
      const serveDsRes = await CliBridge.serveDesignSystem(workspaceDir);
      if (serveDsRes.url) {
        systemPreviewUrl = serveDsRes.url;
      }
    }

    return {
      hasCanvas: meta.hasCanvas,
      canvasTitle: typeof meta.canvasJson?.title === "string" ? meta.canvasJson.title : undefined,
      boardCount: meta.boards.length,
      boards: meta.boards,
      boardsDetail: meta.boardsDetail,
      dashboards: meta.dashboards,
      hasClaudeData: meta.dashboards.length > 0,
      previewUrl,
      systemPreviewUrl,
      workspacePath: workspaceDir,
      hasDesignSystem: meta.hasDesignSystem,
      designSystem: meta.designSystemJson,
      checkResult,
    };
  }

  /**
   * 平台产物枚举契约（listArtifacts）实现：
   * 聚合画板 boards、Claude Data 看板与 Design System 规范文件
   */
  static async listArtifacts(workspaceDir: string): Promise<AppArtifactItem[]> {
    const meta = await CliBridge.getWorkspaceDesignMeta(workspaceDir);
    const artifacts: AppArtifactItem[] = [];

    // 1. 视觉画板产物（单板维度与整体画布）
    if (meta.hasCanvas) {
      artifacts.push({
        id: "canvas:index",
        name: typeof meta.canvasJson?.title === "string" ? meta.canvasJson.title : "视觉设计画板总引",
        type: "canvas",
        path: "project/canvas.json",
        updatedAt: Date.now(),
      });

      for (const board of meta.boardsDetail) {
        artifacts.push({
          id: `board:${board.key}`,
          name: `${board.title} (${board.width}×${board.height})`,
          type: "board",
          path: `project/${board.key}`,
          updatedAt: Date.now(),
        });
      }
    }

    // 2. Claude Data 数据看板产物
    for (const d of meta.dashboards) {
      artifacts.push({
        id: d.id,
        name: d.title,
        type: "dashboard",
        path: d.relativePath,
        sizeBytes: d.sizeBytes,
        updatedAt: d.updatedAt || Date.now(),
      });
    }

    // 3. 设计系统规范
    if (meta.hasDesignSystem) {
      artifacts.push({
        id: "design-system:tokens",
        name: "Design System Tokens",
        type: "system",
        path: "project/design-system.json",
        updatedAt: Date.now(),
      });
    }

    return artifacts;
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
   * 手动控制设计系统服务
   */
  static async serveSystem(workspaceDir: string) {
    return CliBridge.serveDesignSystem(workspaceDir);
  }

  static async stopSystem(workspaceDir: string) {
    return CliBridge.stopDesignSystem(workspaceDir);
  }

  /**
   * 触发设计系统代码审查
   */
  static async audit(targetDir: string) {
    return CliBridge.auditDesignSystem(targetDir);
  }
}
