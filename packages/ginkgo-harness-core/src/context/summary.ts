import type { CoreMessage } from "ai";

function roleOf(m: unknown): string {
  return ((m as { role?: unknown } | null)?.role as string) ?? "";
}

function textOf(m: unknown): string {
  const content = (m as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p &&
        typeof p === "object" &&
        typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : ""
      )
      .join("");
  }
  return "";
}

/**
 * 序列化历史消息用于摘要输入，对单条超长消息截断以防超出摘要模型上下文
 */
export function serializeMessagesForSummary(
  messages: CoreMessage[],
  maxCharsPerMessage: number = 4000
): string {
  return messages
    .map((m) => {
      const text = textOf(m);
      const clipped =
        text.length > maxCharsPerMessage
          ? `${text.slice(0, maxCharsPerMessage)}…`
          : text;
      return `[${roleOf(m)}] ${clipped}`;
    })
    .join("\n\n");
}

export interface SummaryPromptOptions {
  /** 本次需要压缩的消息历史 */
  covered: CoreMessage[];
  /** 前序已有的摘要（增量压缩模式） */
  previousSummary?: string;
  /** 上层业务可注入的重点保留关注项（如关键指标、表名、决策等） */
  domainGuidelines?: string[];
  /** 期望摘要的最大字数（缺省 1200） */
  maxWords?: number;
}

export const DEFAULT_SUMMARY_MAX_TOKENS = 2048;

/**
 * 构建通用的会话历史压缩摘要 Prompt
 */
export function buildGenericSummaryPrompt(opts: SummaryPromptOptions): string {
  const { covered, previousSummary, domainGuidelines, maxWords = 1200 } = opts;

  const guidelinesBlock =
    domainGuidelines && domainGuidelines.length > 0
      ? `\n特别关注并必须保留：\n${domainGuidelines
          .map((g, i) => `${i + 1}. ${g}`)
          .join("\n")}\n`
      : "";

  return `你是一个会话历史压缩器。把下面的会话历史压缩成一份连贯紧凑的中文摘要（不超过 ${maxWords} 字），供后续对话作为上下文背景使用。
${guidelinesBlock}
必须丢弃：冗余工具调用细节、底层代码/数据原文字节、重复寒暄与无意义过渡。
${
  previousSummary
    ? `\n此前的历史摘要（请在其基础上增量合并更新，避免遗漏关键结论）：\n${previousSummary}\n`
    : ""
}
需要压缩的会话片段：
${serializeMessagesForSummary(covered)}`;
}
