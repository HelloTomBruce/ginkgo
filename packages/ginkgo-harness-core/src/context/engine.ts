import type { CoreMessage } from "ai";
import type {
  ContextBudget,
  ContextEngineOptions,
  ProjectionResult,
} from "./types";
import {
  computeContextBudget,
  resolveContextWindow,
} from "./budget";
import { projectMessagesWithPruning } from "./pruning";
import { trimOrphanToolMessages } from "./sanitizer";

/**
 * 通用上下文治理引擎
 * 提供模型上下文窗口动态解析、保留水位预算计算、工具结果精简裁剪与协议边界净化。
 */
export class ContextEngine {
  constructor(public readonly options: ContextEngineOptions = {}) {}

  /**
   * 解析指定模型上下文窗口大小
   */
  resolveWindow(model: string, clientHint?: unknown): number {
    return resolveContextWindow(model, clientHint, this.options.catalog);
  }

  /**
   * 计算指定窗口的保留水位预算
   */
  computeBudget(
    window: number,
    maxOutputTokens: number = 4096,
    reserveRatio: number = 0.25
  ): ContextBudget {
    return computeContextBudget(window, maxOutputTokens, reserveRatio);
  }

  /**
   * 执行消息投影与第一道 Pruning
   */
  project(opts: {
    messages: CoreMessage[];
    budget: ContextBudget;
    anchorTokens?: number;
    systemTokens?: number;
  }): ProjectionResult {
    return projectMessagesWithPruning({
      ...opts,
      tokenizer: this.options.tokenizer,
      isProtectedMessage: this.options.isProtectedMessage,
      placeholderFormatter: this.options.placeholderFormatter,
    });
  }

  /**
   * 净化摘要/截断后的消息边界，移除孤儿工具结果并确保首条为 user
   */
  trimBoundary(
    messages: CoreMessage[],
    fallbackUserPrompt?: string
  ): CoreMessage[] {
    return trimOrphanToolMessages(messages, fallbackUserPrompt);
  }
}
