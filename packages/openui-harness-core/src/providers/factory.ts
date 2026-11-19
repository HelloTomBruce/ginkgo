import {
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  createResilientFetch,
  resolveResiliencePolicy,
  type ResiliencePolicy,
  type ResolvedModelSpec,
} from "./resilience";
import { createReasoningFetch } from "../reasoning/reasoningStream";

export interface ResilienceTelemetryHooks {
  onRetry?: (info: {
    attempt: number;
    errorClass: string;
    delayMs: number;
    reason: string;
  }) => void;
  onCircuitBreak?: (info: { repeats: number; totalChars: number }) => void;
}

export interface ModelFactoryOptions {
  resiliencePolicy?: ResiliencePolicy;
  telemetryHooks?: ResilienceTelemetryHooks;
  customFetch?: typeof globalThis.fetch;
}

/**
 * 组装符合规范的 LanguageModel 实例：
 * 1. 协议分派（OpenAI 兼容端点 / Anthropic 端点）
 * 2. 韧性注入（指数退避重试 + 尊重 Retry-After + 超时控制）
 * 3. 针对 OpenAI 兼容端点的非标思考流拦截与重复循环熔断
 * 4. 提取 <think> 标签为标准 reasoning 分块
 */
export function buildLanguageModel(
  spec: ResolvedModelSpec,
  options: ModelFactoryOptions = {}
): LanguageModel {
  const baseFetch = options.customFetch ?? fetch;
  const resolvedPolicy = options.resiliencePolicy
    ? resolveResiliencePolicy(options.resiliencePolicy)
    : undefined;
  const hooks = options.telemetryHooks;

  const normalizedBase = spec.baseURL.replace(/\/+$/, "");
  const anthropicBase = /\/v1$/.test(normalizedBase)
    ? normalizedBase
    : `${normalizedBase}/v1`;

  const resilienceRetryHooks = hooks?.onRetry
    ? { onRetry: hooks.onRetry }
    : undefined;

  let guardedFetch = baseFetch;

  if (spec.protocol === "anthropic") {
    guardedFetch = resolvedPolicy
      ? createResilientFetch(baseFetch, resolvedPolicy, resilienceRetryHooks)
      : baseFetch;
  } else {
    const reasoningFetch = createReasoningFetch(baseFetch, {
      onCircuitBreak: hooks?.onCircuitBreak,
    });
    guardedFetch = resolvedPolicy
      ? createResilientFetch(reasoningFetch, resolvedPolicy, resilienceRetryHooks)
      : reasoningFetch;
  }

  const baseModel =
    spec.protocol === "anthropic"
      ? createAnthropic({
          apiKey: spec.apiKey,
          baseURL: anthropicBase,
          fetch: guardedFetch,
        })(spec.model)
      : createOpenAI({
          apiKey: spec.apiKey,
          baseURL: normalizedBase,
          fetch: guardedFetch,
        })(spec.model);

  return baseModel && typeof baseModel === "object"
    ? wrapLanguageModel({
        model: baseModel,
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      })
    : baseModel;
}
