/**
 * @ginkgolab/browser - 核心工具适配与装配层
 * 将 dsh-browser-view 的工业级能力无缝转化为 Vercel AI SDK 标准 Tool 集合。
 */

import path from "node:path";
import { tool, jsonSchema, type Tool } from "ai";
import { collectToolDefinitions } from "dsh-browser-view/mcp";
import { toolFailure } from "@ginkgolab/app-sdk";
import { buildBrowserPromptSection } from "./prompts";
import type { BrowserToolsPackage, CreateBrowserToolsOptions } from "./types";

/**
 * dsh-browser 装配配置的本地显式投影：dsh 未导出精确配置类型，
 * 以本接口声明实际传递的字段面为事实来源，类型断言收敛为单点。
 */
interface DshCollectConfig {
  headless: boolean;
  toolset: CreateBrowserToolsOptions["toolset"];
  scope: "session";
  workspaceDir: string;
  screenshotDir: string;
  downloadDir: string;
  baselineDir: string;
  timeoutMs: number;
  confirmMode: CreateBrowserToolsOptions["confirmMode"];
}

interface ToolRunContext {
  signal: AbortSignal;
  agent?: {
    id?: string;
    session?: {
      meta?: {
        cwd?: string;
      };
    };
  };
  cwd?: string;
}

/**
 * 只读探查模式工具白名单（Plan 规划期）：
 * 严格限制为无副作用的浏览、快照提取、网络分析与截图。
 */
export const READONLY_BROWSER_TOOLS = new Set([
  "browser_open",
  "browser_snapshot",
  "browser_find",
  "browser_elements",
  "browser_screenshot",
  "browser_wait_for",
  "browser_wait",
  "browser_network",
  "browser_doctor",
  "browser_status",
]);

/**
 * 创建与会话绑定的浏览器工具集合
 */
export function createBrowserTools({
  sessionId,
  workspaceDir,
  permissionLevel = "full",
  toolset = "core",
  headless = true,
  confirmMode = "off",
  timeoutMs = 30000,
}: CreateBrowserToolsOptions): BrowserToolsPackage {
  // 1. 构建 dsh-browser 配置对象（绑定 Ginkgo 会话命名空间与工作区目录）
  const browserConfig: DshCollectConfig = {
    headless,
    toolset,
    scope: "session",
    workspaceDir,
    screenshotDir: path.join(workspaceDir, "screenshots"),
    downloadDir: path.join(workspaceDir, "downloads"),
    baselineDir: path.join(workspaceDir, "baselines"),
    timeoutMs,
    confirmMode,
  };

  // 2. 收集规范化工具定义 Map<string, PlainToolDefinition>
  // dsh-browser 内部在此阶段已完成审批闸拦截、指纹自愈录制等包装
  // （dsh 未导出精确配置类型：按 DshCollectConfig 显式投影单点断言）
  const toolDefs = collectToolDefinitions(
    browserConfig as unknown as Parameters<typeof collectToolDefinitions>[0]
  );
  const tools: Record<string, Tool> = {};
  const toolNames: string[] = [];

  for (const [name, def] of toolDefs.entries()) {
    // 权限档过滤：只读模式下跳过具有写副作用的交互工具（如 click, type, fill, eval 等）
    if (permissionLevel === "readonly" && !READONLY_BROWSER_TOOLS.has(name)) {
      continue;
    }

    // 将 JSON Schema 参数转换为 AI SDK 的参数校验对象
    const parameters = jsonSchema(
      (def.parameters as unknown as Parameters<typeof jsonSchema>[0]) ?? {
        type: "object",
        properties: {},
      }
    );

    tools[name] = tool({
      description: def.description,
      parameters,
      execute: async (args: unknown, { abortSignal }) => {
        const runCtx: ToolRunContext = {
          signal: abortSignal ?? new AbortController().signal,
          agent: {
            id: sessionId,
            session: {
              meta: {
                cwd: workspaceDir,
              },
            },
          },
          cwd: workspaceDir,
        };

        try {
          const result = await def.execute(args, runCtx);
          return result;
        } catch (err) {
          // 取消语义不可吞：AbortError 必须透传。若在此收敛为失败结果，
          // 会架空外层流式切面（ginkgo-llm safeExecutionAspect）的取消处理
          if (err instanceof Error && err.name === "AbortError") throw err;
          const message = err instanceof Error ? err.message : String(err);
          return toolFailure(name, message);
        }
      },
    });

    toolNames.push(name);
  }

  // 3. 构建提示词片段与清理句柄
  const promptSection = buildBrowserPromptSection(permissionLevel);

  const dispose = async () => {
    // 优先调用工具集合内的 browser_close 平稳关闭当前会话的浏览器
    const closeDef = toolDefs.get("browser_close");
    if (closeDef) {
      try {
        await closeDef.execute({}, {
          signal: new AbortController().signal,
          agent: { id: sessionId },
          cwd: workspaceDir,
        });
      } catch {
        // 忽略关闭时的静默异常
      }
    }
  };

  return {
    tools,
    toolNames,
    promptSection,
    dispose,
  };
}
