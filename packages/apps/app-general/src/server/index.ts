import path from "node:path";
import fs from "node:fs/promises";
import { toolFailure, type AppActionContext, type AppServerContext } from "@ginkgo/app-sdk";
import { createSandboxTools } from "@ginkgo/sandbox";
import { createBrowserTools } from "@ginkgo/browser";
import type { BrowserToolsPackage } from "@ginkgo/browser";

/**
 * 通用助手的沙箱与浏览器工具装配（运行时实现，仅服务端经 `@ginkgo-apps/general/server`
 * 入口消费——宿主组合根 runtimeServers 注入；不得进应用包主入口，否则 Node
 * 内置模块泄漏进客户端 bundle）。
 *
 * 1. 消费平台 ginkgo-sandbox 能力包（atomic 预设 = read/edit/write/bash 四原子工具）。
 * 2. 消费平台 ginkgo-browser 能力包（基于 dsh-browser-view 的工业级 Playwright 自动化工具）。
 * 宿主经 ctx.workspace 注入沙箱目录；缺失时降级进程内默认沙箱。
 *
 * mode 联动权限（应用策略，能力包只提供档位）：plan 阶段收敛为只读
 * （沙箱禁止写文件/执行命令，浏览器仅支持打开/截图/探查无写副作用操作）；
 * 写入、命令执行与网页交互在方案经用户确认（execute/direct 请求）后解锁。
 */
export function getGeneralTools(ctx: AppServerContext) {
  const sandboxDir =
    ctx.workspace?.sandboxDir ||
    path.join(process.cwd(), "data", "workspaces", "general", ctx.sessionId || "default");
  const permission = ctx.mode === "plan" ? "readonly" : "full";

  const sandboxTools = createSandboxTools({
    sandboxDir,
    preset: "atomic",
    permission,
  });

  const browserPkg = createBrowserTools({
    sessionId: ctx.sessionId || "default",
    workspaceDir: sandboxDir,
    permissionLevel: permission,
    toolset: "core",
    headless: true,
  });

  return {
    ...sandboxTools,
    ...browserPkg.tools,
  };
}

/**
 * 动作分发场景的浏览器工具装配缓存（key = sessionId:workspaceDir）。
 * 三层兜底关系：
 * 1. 本缓存避免重复装配轻量工具定义集合；
 * 2. 底层 dsh-browser 按 session 作用域复用并自持浏览器实例（空闲驱逐）；
 * 3. 会话销毁时宿主经 AppServerContract.onSessionEnd 触发
 *    releaseGeneralSessionResources 显式 dispose + 缓存淘汰。
 * 注意：getGeneralTools（每次 LLM 请求）刻意不 dispose——同一会话跨请求
 * 复用浏览器是有意行为（请求 1 开页、请求 2 截图共享同一实例）。
 */
const actionBrowserToolsCache = new Map<string, BrowserToolsPackage>();

/**
 * 会话终止：释放该会话关联的全部浏览器工具装配（供宿主 onSessionEnd 触发）
 */
export async function releaseGeneralSessionResources(sessionId: string): Promise<void> {
  for (const [key, pkg] of actionBrowserToolsCache) {
    if (!key.startsWith(`${sessionId}:`)) continue;
    actionBrowserToolsCache.delete(key);
    try {
      await pkg.dispose();
    } catch {
      // 释放失败不阻塞会话删除；dsh 空闲驱逐兜底
    }
  }
}

/**
 * AppServerContract.onSessionEnd 组合根接线（宿主 DELETE 会话时触发）
 */
export const onSessionEnd = releaseGeneralSessionResources;

function getActionBrowserTools(sessionId: string, workspaceDir: string): BrowserToolsPackage {
  const key = `${sessionId}:${workspaceDir}`;
  let pkg = actionBrowserToolsCache.get(key);
  if (!pkg) {
    pkg = createBrowserTools({
      sessionId,
      workspaceDir,
      permissionLevel: "full",
      toolset: "core",
      headless: true,
    });
    actionBrowserToolsCache.set(key, pkg);
  }
  return pkg;
}

/**
 * 通用助手自治动作分发网关实现（承接 /api/apps/general/action）
 */
export async function dispatchGeneralAction(
  action: string,
  _payload: Record<string, unknown>,
  ctx: AppActionContext
): Promise<unknown> {
  const workspaceDir = ctx.workspaceDir;

  if (action === "browser_status") {
    const screenshotsDir = path.join(workspaceDir, "screenshots");
    const downloadsDir = path.join(workspaceDir, "downloads");

    let screenshots: Array<{ name: string; path: string; updatedAt: number }> = [];
    try {
      const files = await fs.readdir(screenshotsDir, { withFileTypes: true });
      screenshots = await Promise.all(
        files
          .filter((f) => f.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(f.name))
          .map(async (f) => {
            const stat = await fs.stat(path.join(screenshotsDir, f.name));
            return {
              name: f.name,
              path: `screenshots/${f.name}`,
              updatedAt: stat.mtimeMs,
            };
          })
      );
      screenshots.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      // 目录不存在时静默跳过
    }

    let downloads: Array<{ name: string; path: string; size: number; updatedAt: number }> = [];
    try {
      const files = await fs.readdir(downloadsDir, { withFileTypes: true });
      downloads = await Promise.all(
        files
          .filter((f) => f.isFile())
          .map(async (f) => {
            const stat = await fs.stat(path.join(downloadsDir, f.name));
            return {
              name: f.name,
              path: `downloads/${f.name}`,
              size: stat.size,
              updatedAt: stat.mtimeMs,
            };
          })
      );
      downloads.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      // 目录不存在时静默跳过
    }

    return {
      status: "ready",
      screenshots,
      downloads,
      hasScreenshots: screenshots.length > 0,
      hasDownloads: downloads.length > 0,
    };
  }

  if (action === "browser_capture_screenshot") {
    try {
      const browserPkg = getActionBrowserTools(ctx.sessionId || "default", workspaceDir);

      const shotTool = browserPkg.tools.browser_screenshot;
      if (!shotTool || typeof shotTool.execute !== "function") {
        throw new Error("未加载 browser_screenshot 工具能力");
      }

      const shotResult = (await shotTool.execute(
        {},
        { messages: [], toolCallId: `manual-shot-${Date.now()}` }
      )) as Record<string, unknown>;

      const rawPath = String(shotResult.path || shotResult.filePath || "");
      const fileName = path.basename(rawPath);
      const relPath = `screenshots/${fileName}`;

      return {
        success: true,
        screenshot: {
          name: fileName,
          path: relPath,
          updatedAt: Date.now(),
        },
      };
    } catch (err) {
      return toolFailure(null, err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`Unknown general action: ${action}`);
}
