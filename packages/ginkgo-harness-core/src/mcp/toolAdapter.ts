import { jsonSchema, type CoreTool } from "ai";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { MCPClientManager } from "./clientManager";
import type { MCPServerConfig } from "./types";

/**
 * 将 MCP Tool 转换为 Vercel AI SDK 的 CoreTool 规范
 */
export function adaptMcpToolToCoreTool(
  tool: Tool,
  serverId: string,
  manager: MCPClientManager,
  config?: MCPServerConfig
): CoreTool {
  const shouldPrefix = config?.prefixToolName ?? true;
  const toolName = shouldPrefix ? `${serverId}_${tool.name}` : tool.name;

  return {
    description: tool.description ?? `MCP Tool: ${tool.name} (from ${serverId})`,
    parameters: tool.inputSchema
      ? jsonSchema<Record<string, unknown>>(
          tool.inputSchema as Record<string, unknown>
        )
      : z.record(z.string(), z.any()),
    execute: async (args: Record<string, unknown>) => {
      try {
        const result = await manager.callTool(serverId, tool.name, args);

        // 工具级业务错误：结构化反馈给模型自我纠正，不上抛——execute 抛错在
        // ai@4 中会作为 ToolExecutionError 终结整个会话流（与 datasources 包
        // toAiTools 的 { error, isError } 约定一致）
        if (result.isError) {
          const errorText = result.content
            .map((c) => c.text ?? JSON.stringify(c))
            .join("\n");
          return {
            error: `[MCP Tool Error] ${toolName}: ${errorText}`,
            isError: true,
          };
        }

        // 提取所有 text 内容
        const texts = result.content
          .map((c) => {
            if (c.type === "text" && typeof c.text === "string") {
              return c.text;
            }
            return JSON.stringify(c);
          })
          .join("\n");

        // 尝试解析 JSON，如果成功直接返回结构化对象，否则返回字符串文本
        try {
          return JSON.parse(texts);
        } catch {
          return texts;
        }
      } catch (err) {
        // 网络/超时/未注册等传输层失败：同样反馈给模型，不终结会话流
        return {
          error: `MCP 工具 ${toolName} 调用失败: ${
            err instanceof Error ? err.message : String(err)
          }。请检查参数后重试，或改用其他方式继续任务。`,
          isError: true,
        };
      }
    },
  };
}

/**
 * 扫描并批量提取指定 Server 或全部 Server 的 CoreTools 映射表
 */
export async function getCoreToolsFromMcp(
  manager: MCPClientManager,
  configs: MCPServerConfig[]
): Promise<Record<string, CoreTool>> {
  const toolsMap: Record<string, CoreTool> = {};

  for (const conf of configs) {
    try {
      const mcpTools = await manager.listTools(conf.id);
      for (const t of mcpTools) {
        const shouldPrefix = conf.prefixToolName ?? true;
        const key = shouldPrefix ? `${conf.id}_${t.name}` : t.name;
        toolsMap[key] = adaptMcpToolToCoreTool(t, conf.id, manager, conf);
      }
    } catch (err) {
      // 容错：单个 Server 离线或报错不阻断其他 Server 的工具挂载
      console.warn(
        `[MCP] 挂载 Server [${conf.id}] 工具失败:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return toolsMap;
}
