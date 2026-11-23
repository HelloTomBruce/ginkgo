import type { CoreMessage } from "ai";

function roleOf(m: unknown): string {
  return ((m as { role?: unknown } | null)?.role as string) ?? "";
}

/**
 * 历史截断或摘要修剪后的协议边界清理：
 * 1. 丢弃开头的孤儿 tool 消息（其前置 assistant tool-call 已被截掉，很多 Provider 会报错拒绝）
 * 2. 保证首条消息为 user 消息（主流 Provider 如 Anthropic 强制首条为 user）
 */
export function trimOrphanToolMessages(
  messages: CoreMessage[],
  fallbackUserPrompt: string = "（以上是此前会话的摘要，请基于此继续当前任务。）"
): CoreMessage[] {
  let start = 0;
  while (start < messages.length && roleOf(messages[start]) === "tool") {
    start++;
  }

  const trimmed = messages.slice(start);

  if (trimmed.length === 0 || roleOf(trimmed[0]) !== "user") {
    return [
      {
        role: "user",
        content: fallbackUserPrompt,
      } as CoreMessage,
      ...trimmed,
    ];
  }

  return trimmed;
}
