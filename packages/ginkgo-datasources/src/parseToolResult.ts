/**
 * 数据源工具调用结果的统一解析：错误透传、text 内容拼接、JSON 尝试解析。
 * manager 工具绑定与适配器共用，避免重复实现漂移。
 */

/** 解析产物：JSON 值（对象/数组/标量）或未解析的原始文本 */
export type ParsedToolResult =
  | string
  | number
  | boolean
  | null
  | ParsedToolResult[]
  | { [key: string]: ParsedToolResult };

/** 向后兼容别名 */
export type McpParsedResult = ParsedToolResult;

interface ToolContentItem {
  type: string;
  text?: string;
}

export function parseToolResult(
  res: unknown,
  toolLabel: string
): ParsedToolResult {
  const r = (res ?? {}) as { content?: unknown; isError?: boolean };
  const contentList = Array.isArray(r.content)
    ? (r.content as ToolContentItem[])
    : [];

  if (r.isError) {
    const errorText = contentList.map((c) => c.text || "").join("\n");
    throw new Error(errorText || `${toolLabel} execution failed`);
  }

  const textOutput = contentList
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n");

  try {
    return JSON.parse(textOutput);
  } catch {
    return textOutput;
  }
}

/** 向后兼容别名 */
export const parseMcpToolResult = parseToolResult;
