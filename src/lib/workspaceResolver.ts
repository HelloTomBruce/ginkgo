import fs from "node:fs/promises";
import path from "node:path";
import type { AppWorkspaceContext } from "@ginkgo/app-sdk";
// 路径守卫唯一实现在 ginkgo-sandbox 能力包（沙箱语义的所有者），宿主 re-export
import { assertSafePath } from "@ginkgo/sandbox";

export const DEFAULT_WORKSPACES_ROOT = path.join(process.cwd(), "data", "workspaces");

export interface ResolveWorkspaceOptions {
  appId: string;
  sessionId?: string;
  customRootDir?: string;
  baseDir?: string;
}

/**
 * 解析并准备通用工作区沙箱上下文
 */
export async function resolveWorkspaceContext(
  opts: ResolveWorkspaceOptions
): Promise<AppWorkspaceContext> {
  const { appId, sessionId, customRootDir, baseDir = DEFAULT_WORKSPACES_ROOT } = opts;
  // 安全会话标识符清洗（防止路径穿越）
  const safeSessionId = (sessionId ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeAppId = appId.replace(/[^a-zA-Z0-9_-]/g, "_");

  const sandboxDir = customRootDir
    ? path.resolve(customRootDir)
    : path.join(baseDir, safeAppId, safeSessionId);

  // 确保工作区物理目录存在
  await fs.mkdir(sandboxDir, { recursive: true });

  return {
    appId,
    sessionId,
    sandboxDir,
    customRootDir,
  };
}

/**
 * 安全校验：将入参相对路径解析至工作区内，严防路径穿越（Path Traversal）。
 * 实现委托 ginkgo-sandbox 的 assertSafePath（唯一实现），本导出仅为存量
 * 消费方（/api/workspace 等）保持稳定入口。
 */
export function resolveSafeWorkspacePath(workspaceDir: string, targetPath: string): string {
  return assertSafePath(workspaceDir, targetPath);
}
