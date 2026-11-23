import {
  defaultModelCatalog,
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_CONTEXT_WINDOW,
  type ModelCatalog,
} from "../providers/registry";
import type { ContextBudget } from "./types";

export {
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_CONTEXT_WINDOW,
};

/**
 * 解析模型的上下文窗口大小：
 * 优先使用 clientHint，其次从 ModelCatalog 最长前缀匹配查表，最后兜底默认窗口；
 * 并钳制在 [CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX] 区间。
 */
export function resolveContextWindow(
  model: string,
  clientHint?: unknown,
  catalog: ModelCatalog = defaultModelCatalog
): number {
  return catalog.resolveContextWindow(model, clientHint);
}

/**
 * 计算上下文水位预算：
 * - window: 总窗口大小
 * - maxOutputTokens: 模型最大输出 token 数
 * - reserveRatio: 最近历史保留预算占窗口比例（缺省 25%）
 */
export function computeContextBudget(
  window: number,
  maxOutputTokens: number = 4096,
  reserveRatio: number = 0.25
): ContextBudget {
  const triggerAt = Math.min(
    Math.floor(window * 0.7),
    window - maxOutputTokens - 8192
  );
  return {
    window,
    triggerAt: Math.max(triggerAt, 1024),
    retainTokens: Math.floor(window * Math.max(0.1, Math.min(reserveRatio, 0.5))),
  };
}
