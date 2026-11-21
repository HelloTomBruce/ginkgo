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
  buildGenericSummaryPrompt,
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
  buildGenericSummaryPrompt,
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

/** 摘要输出上限（设计定稿：2k token） */
export const SUMMARY_MAX_TOKENS = DEFAULT_SUMMARY_MAX_TOKENS;
