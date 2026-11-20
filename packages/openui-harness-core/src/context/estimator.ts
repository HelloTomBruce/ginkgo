import { estimateTextTokensHeuristic } from "../tokenizer";

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * 单条消息 Token 估算：
 * 包含 role 与分隔符结构开销（基础 8 tokens），
 * 支持 AI SDK UI Message 镜像去重与复杂 parts 序列化。
 */
export function estimateMessageTokens(
  message: unknown,
  countText: (text: string) => number = estimateTextTokensHeuristic
): number {
  const m = message as { role?: string; content?: unknown } | null;
  if (!m || typeof m !== "object") return 0;

  let tokens = 8; // role/结构基础开销
  const rest = m as Record<string, unknown>;

  // AI SDK 消息模型兼容：优先使用结构化 parts，避免 content 与 toolInvocations 重复统计
  if (Array.isArray(rest.parts) && rest.parts.length > 0) {
    tokens += countText(safeSerialize(rest.parts));
  } else {
    if (typeof m.content === "string") {
      tokens += countText(m.content);
    } else if (m.content !== undefined && m.content !== null) {
      tokens += countText(safeSerialize(m.content));
    }
    if (rest.toolInvocations !== undefined) {
      tokens += countText(safeSerialize(rest.toolInvocations));
    }
  }

  if (rest.annotations !== undefined) {
    tokens += countText(safeSerialize(rest.annotations));
  }

  return tokens;
}

/**
 * 消息列表 Token 总量估算
 */
export function estimateMessagesTokens(
  messages: unknown[],
  countText: (text: string) => number = estimateTextTokensHeuristic
): number {
  let total = 0;
  for (const m of messages) {
    total += estimateMessageTokens(m, countText);
  }
  return total;
}
