import type { CoreMessage } from "ai";
import {
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
  computeContextBudget,
  estimateTextTokensHeuristic,
  estimateMessageTokens,
  estimateMessagesTokens,
  projectMessagesWithPruning,
  trimOrphanToolMessages,
  DEFAULT_PRUNED_PLACEHOLDER,
  DEFAULT_SUMMARY_MAX_TOKENS,
  type ContextBudget,
  type ProjectionResult,
} from "@openui-analytics/harness-core/context";

export {
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
  estimateMessageTokens,
  estimateMessagesTokens,
  type ContextBudget,
  type ProjectionResult,
};

/**
 * 计算上下文水位预算
 */
export function computeBudget(
  window: number,
  maxOutputTokens: number
): ContextBudget {
  return computeContextBudget(window, maxOutputTokens);
}

/** 文本 token 估算（启发式） */
export function estimateTextTokens(text: string): number {
  return estimateTextTokensHeuristic(text);
}

// ========== 消息形态判定（OpenUI 领域特定） ==========

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

/** 最近一张 PlanReviewCard 所在 assistant 消息的下标（无则 -1） */
export function findLastPlanReviewIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) !== "assistant") continue;
    if (/PlanReviewCard\s*\(/.test(textOf(messages[i]))) return i;
    break; // 只看最近一条 assistant（与前端 awaitingPlanConfirm 语义一致）
  }
  return -1;
}

/** 裁剪占位符：保留工具名与调用关联（协议完整性），替换原始结果 */
export const PRUNED_PLACEHOLDER = DEFAULT_PRUNED_PLACEHOLDER;

// ========== 投影 ==========

/**
 * 构造发往模型的投影。
 * 委托 @openui-analytics/harness-core 的通用 projectMessagesWithPruning 引擎。
 */
export function projectMessages(opts: {
  messages: CoreMessage[];
  budget: ContextBudget;
  /** usage.promptTokens 实测锚点（会话元数据） */
  anchorTokens?: number;
  /** system prompt 估算 token */
  systemTokens?: number;
  /** 真实 tokenizer（WS-12 可选注入；缺省 CJK 启发式，行为不变） */
  tokenizer?: { encode(text: string): number };
}): ProjectionResult {
  return projectMessagesWithPruning(opts);
}

/**
 * 摘要裁剪后的边界清理：
 * 委托 @openui-analytics/harness-core 的 trimOrphanToolMessages
 */
export function trimAfterSummaryCut(messages: CoreMessage[]): CoreMessage[] {
  return trimOrphanToolMessages(messages);
}

// ========== OpenUI 数据分析摘要提示词生成 ==========

/** 摘要生成输入的序列化：每条消息截断 4000 字符（tool 结果已被裁剪/无需全文） */
function serializeForSummary(messages: CoreMessage[]): string {
  return messages
    .map((m) => {
      const text = textOf(m);
      const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      return `[${roleOf(m)}] ${clipped}`;
    })
    .join("\n\n");
}

export function buildSummaryPrompt(opts: {
  covered: CoreMessage[];
  previousSummary?: string;
}): string {
  const { covered, previousSummary } = opts;
  return `你是一个数据分析会话的压缩器。把下面的会话历史压缩成一份中文摘要（不超过 1200 字），供后续对话作为背景使用。

必须保留：
1. 用户的原始分析目标与每一轮追问
2. 已确认的分析方案（PlanReviewCard 的方法、步骤、数据源选择）
3. 关键结论与数字（指标值、排名、异常点）
4. 用过的数据源、表名、关键字段与过滤条件
5. 未解决的澄清问题或用户偏好

必须丢弃：工具的原始输出细节、看板 DSL 代码、重复的客套话。
${previousSummary ? `\n此前的摘要（请在其基础上增量更新，不要重复劳动）：\n${previousSummary}\n` : ""}
需要压缩的会话历史：
${serializeForSummary(covered)}`;
}

/** 摘要输出上限（设计定稿：2k token） */
export const SUMMARY_MAX_TOKENS = DEFAULT_SUMMARY_MAX_TOKENS;
