import type { CoreMessage } from "ai";
import type { ContextBudget, ProjectionResult } from "./types";
import { estimateMessageTokens, estimateMessagesTokens } from "./estimator";
import { estimateTextTokensHeuristic, type TokenizerEstimator } from "../tokenizer";

export const DEFAULT_PRUNED_PLACEHOLDER = (toolName: string) =>
  `[已裁剪: ${toolName}]`;

function roleOf(m: unknown): string {
  return ((m as { role?: unknown } | null)?.role as string) ?? "";
}

function toolNamesOf(m: unknown): string[] {
  const content = (m as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (p): p is Record<string, unknown> => p !== null && typeof p === "object"
    )
    .filter((p) => p.type === "tool-result")
    .map((p) => (typeof p.toolName === "string" ? p.toolName : "tool"));
}

export interface ProjectMessagesOptions {
  messages: CoreMessage[];
  budget: ContextBudget;
  /** usage.promptTokens 实测锚点（若有，校准首轮/未修改阶段） */
  anchorTokens?: number;
  /** system prompt 估算 token */
  systemTokens?: number;
  /** Tokenizer 估算器（可选注入；缺省使用启发式） */
  tokenizer?: TokenizerEstimator;
  /** 消息保护豁免谓词 */
  isProtectedMessage?: (
    message: CoreMessage,
    index: number,
    total: number
  ) => boolean;
  /** 自定义裁剪占位符 */
  placeholderFormatter?: (toolName: string) => string;
}

/**
 * 构造面向 LLM 的投影消息列表。
 * 输入的 messages 保持原样不被修改。
 */
export function projectMessagesWithPruning(
  opts: ProjectMessagesOptions
): ProjectionResult {
  const { messages, budget } = opts;
  const overhead = opts.systemTokens ?? 0;
  const countText: (text: string) => number = opts.tokenizer
    ? opts.tokenizer.encode.bind(opts.tokenizer)
    : estimateTextTokensHeuristic;

  const heuristic = estimateMessagesTokens(messages, countText);
  const estimated = Math.max(heuristic, opts.anchorTokens ?? 0) + overhead;

  // 1. 未超阈值：原样直发，零开销
  if (estimated <= budget.triggerAt) {
    return {
      messages,
      pruned: false,
      prunedCount: 0,
      estimatedPromptTokens: estimated,
      summarizeUpToIndex: -1,
    };
  }

  // 2. 计算保留窗口：从最新消息向前累计直至 retainTokens
  let acc = 0;
  let retainFrom = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(messages[i], countText);
    if (acc + t > budget.retainTokens && retainFrom < messages.length) {
      retainFrom = i + 1;
      break;
    }
    acc += t;
    retainFrom = i;
  }

  // 极端小会话（所有消息都在保留窗口内），已无可剪空间
  if (retainFrom <= 0) {
    return {
      messages,
      pruned: false,
      prunedCount: 0,
      estimatedPromptTokens: estimated,
      summarizeUpToIndex: -1,
    };
  }

  const formatPlaceholder =
    opts.placeholderFormatter ?? DEFAULT_PRUNED_PLACEHOLDER;

  // 3. 执行第一道精简（Pruning）：
  // 只精简保留窗口外且未被豁免的 tool 结果，严格保护 tool-call/result 协议完整性
  let prunedCount = 0;
  const projected = messages.map((m, i) => {
    if (i >= retainFrom) return m; // 保留窗口内原样保留
    if (roleOf(m) !== "tool") return m; // 用户/assistant 不直接剪

    // 检查业务保护豁免
    if (opts.isProtectedMessage?.(m, i, messages.length)) {
      return m;
    }

    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) return m;

    const names = toolNamesOf(m);
    prunedCount += names.length;

    return {
      ...m,
      content: content.map((p) =>
        p !== null &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "tool-result"
          ? {
              ...(p as Record<string, unknown>),
              result: formatPlaceholder(
                typeof (p as { toolName?: unknown }).toolName === "string"
                  ? (p as { toolName: string }).toolName
                  : "tool"
              ),
            }
          : p
      ),
    } as CoreMessage;
  });

  // 4. 重估裁剪后的 token
  const afterPrune = estimateMessagesTokens(projected, countText) + overhead;
  const needSummary = afterPrune > budget.triggerAt;

  return {
    messages: projected,
    pruned: prunedCount > 0,
    prunedCount,
    estimatedPromptTokens: afterPrune,
    summarizeUpToIndex: needSummary ? retainFrom - 1 : -1,
  };
}
