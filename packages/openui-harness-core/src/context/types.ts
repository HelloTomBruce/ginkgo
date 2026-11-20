import type { CoreMessage } from "ai";
import type { TokenizerEstimator } from "../tokenizer/types";
import type { ModelCatalog } from "../providers/registry";

export interface ContextBudget {
  /** 模型上下文总窗口大小（tokens） */
  window: number;
  /** 估算 Prompt 超过此阈值时触发精简（pruning） */
  triggerAt: number;
  /** 保留窗口：最近消息逐字保留的目标 token 预算 */
  retainTokens: number;
}

export interface ProjectionResult {
  /** 投影后的消息列表（已应用工具结果精简占位符） */
  messages: CoreMessage[];
  /** 是否发生了裁剪/精简 */
  pruned: boolean;
  /** 被裁剪精简的 tool 结果数量 */
  prunedCount: number;
  /** 投影后的估算 Prompt tokens */
  estimatedPromptTokens: number;
  /**
   * 若 ≥ 0，表示 pruning 后仍超阈值，[0..该下标] 需要进行摘要覆盖；
   * -1 表示无需摘要。
   */
  summarizeUpToIndex: number;
}

export interface ContextEngineOptions {
  /** 模型目录注册表，用于解析模型上下文窗口 */
  catalog?: ModelCatalog;
  /** 自定义 Tokenizer 估算器（若不提供则使用内置启发式估算） */
  tokenizer?: TokenizerEstimator;
  /**
   * 业务自定义的消息豁免保护回调。
   * 返回 true 的消息即使在保留窗口之外也不会被裁剪或强制移出。
   */
  isProtectedMessage?: (
    message: CoreMessage,
    index: number,
    total: number
  ) => boolean;
  /** 自定义工具结果裁剪占位符格式化函数 */
  placeholderFormatter?: (toolName: string) => string;
}
