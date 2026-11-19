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
      const result = await manager.callTool(serverId, tool.name, args);

      if (result.isError) {
        const errorText = result.content
          .map((c) => c.text ?? JSON.stringify(c))
          .join("\n");
        throw new Error(`[MCP Tool Error] ${toolName}: ${errorText}`);
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
