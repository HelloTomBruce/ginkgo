import fs from "node:fs/promises";
import path from "node:path";
import type { AppWorkspaceContext } from "@openui-analytics/app-sdk";

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
 * 安全校验：将入参相对路径解析至工作区内，严防路径穿越（Path Traversal）
 * 返回安全可用的绝对路径
 */
export function resolveSafeWorkspacePath(workspaceDir: string, targetPath: string): string {
  const root = path.resolve(workspaceDir);
  // targetPath 统一作为相对于 root 的路径处理
  const sanitized = targetPath.startsWith("/") ? targetPath.slice(1) : targetPath;
  const resolved = path.resolve(root, sanitized);

  // 边界校验：必须以 root 为前缀（且带路径分隔符或者是 root 本身）
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`越权访问被阻止：路径 "${targetPath}" 超出了工作区安全范围`);
  }

  return resolved;
}
