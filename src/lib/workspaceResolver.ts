import fs from "node:fs/promises";
import path from "node:path";
import type { AppWorkspaceContext } from "@ginkgolab/app-sdk";
// 路径守卫唯一实现在 ginkgo-sandbox 能力包（沙箱语义的所有者），宿主 re-export
import { assertSafePath } from "@ginkgolab/sandbox";
import { sessionStore } from "@/lib/sessionStore";
import { workspaceStore } from "@/lib/workspaceStore";
import { getWorkspacesRootDir } from "@/lib/storagePaths";

/**
 * 工作区沙箱根目录默认值：**调用时**解析，不在模块加载期固化。
 *
 * 固化会让 `GINKGO_HOME` 在模块 import 之后才生效的调用方（测试、延迟引导）
 * 写到错误的根上；与 dashboardStore 等单例同一约束。
 */
function defaultWorkspacesRoot(): string {
  return getWorkspacesRootDir();
}

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
  const { appId, sessionId, customRootDir, baseDir } = opts;
  // 安全会话标识符清洗（防止路径穿越）
  const safeSessionId = (sessionId ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeAppId = appId.replace(/[^a-zA-Z0-9_-]/g, "_");

  const sandboxDir = customRootDir
    ? path.resolve(customRootDir)
    : path.join(baseDir ?? defaultWorkspacesRoot(), safeAppId, safeSessionId);

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
 * 解析会话绑定的工作区（带自动降级与外部工程路径关联）
 */
export async function resolveWorkspaceForSession(
  appId: string,
  sessionId?: string
): Promise<AppWorkspaceContext> {
  let customRootDir: string | undefined;
  if (sessionId) {
    const sRecord = await sessionStore.get(sessionId);
    if (sRecord?.workspaceId) {
      const ws = await workspaceStore.get(sRecord.workspaceId);
      if (ws?.path) customRootDir = ws.path;
    }
  }
  try {
    return await resolveWorkspaceContext({ appId, sessionId, customRootDir });
  } catch (wsErr) {
    console.warn("[WorkspaceResolver] 解析工作区异常，回退至默认沙箱:", wsErr);
    return await resolveWorkspaceContext({ appId, sessionId });
  }
}

/**
 * 安全校验：将入参相对路径解析至工作区内，严防路径穿越（Path Traversal）。
 * 实现委托 ginkgo-sandbox 的 assertSafePath（唯一实现），本导出仅为存量
 * 消费方（/api/workspace 等）保持稳定入口。
 */
export function resolveSafeWorkspacePath(workspaceDir: string, targetPath: string): string {
  return assertSafePath(workspaceDir, targetPath);
}
