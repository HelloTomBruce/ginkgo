/**
 * Anthropic Prompt Caching 滑动断点编排（领域中立编排设施，middleware 形态）。
 *
 * 为什么需要：多轮任务循环每步重发完整前缀（tools + system + 递增历史），
 * anthropic 协议无缓存标记时每步全价重算（单步 10-60K tokens，最多 50 步）。
 *
 * 为什么挂 provider 中间件而不是消息投影层：AI SDK 多步循环里，step2+ 的
 * 历史是 SDK 在流内追加的 responseMessages，投影只覆盖 initial prompt——
 * 只有 transformParams 能在**每次 HTTP 调用前**拿到完整的最终 prompt。
 *
 * 断点策略：标记**最后一条消息**（message 级 providerMetadata；anthropic 侧
 * 在该消息最后一个 content block 上落 cache_control，即 2.2 铁律的
 * 「断点打在轮次末尾 Block」）。前缀缓存按位置匹配：本步写入的缓存前缀在
 * 下一步的更长 prompt 中仍是前缀 → 步步增量命中；最新 tool_result 被缓存
 * 后，下一步以 -90% 读价命中。step1 即标记（前缀 tools+system+首问 ≥1024
 * token 门槛，tools 2-6K 稳定越过）。
 *
 * 纯函数零污染：只浅克隆被标记的最后一条消息，其余同引用透传。
 * prompt 消息用结构化最小类型（@ai-sdk/provider 非本包直接依赖）。
 */
import { wrapLanguageModel, type LanguageModel, type LanguageModelV1Middleware } from "ai";

/** 结构化最小 prompt 消息形态（仅断点标记所需字段） */
interface CachePromptMessage {
  role: string;
  content: unknown;
  providerMetadata?: Record<string, Record<string, unknown>>;
}

/** Anthropic 缓存断点的 providerMetadata 标记（ephemeral = 5 分钟滑动 TTL） */
const ANTHROPIC_CACHE_MARKER = {
  anthropic: {
    cacheControl: { type: "ephemeral" as const },
  },
};

/**
 * 给 prompt 最后一条消息打 Anthropic 缓存滑动断点（message 级 providerMetadata）。
 * 空 prompt 原样返回；其余消息同引用透传；已有 providerMetadata 合并保留。
 */
export function applyAnthropicCacheBreakpoints<T extends CachePromptMessage>(
  prompt: T[]
): T[] {
  if (prompt.length === 0) return prompt;
  const lastIndex = prompt.length - 1;
  const target = prompt[lastIndex];
  const marked = {
    ...target,
    providerMetadata: {
      ...ANTHROPIC_CACHE_MARKER,
      ...(target.providerMetadata ?? {}),
    },
  };
  const out = prompt.slice();
  out[lastIndex] = marked;
  return out;
}

/** 缓存断点中间件：每次模型调用（generate/stream）前改写最终 prompt */
export function anthropicCacheBreakpointMiddleware(): LanguageModelV1Middleware {
  return {
    middlewareVersion: "v1",
    transformParams: async ({ params }) => ({
      ...params,
      prompt: applyAnthropicCacheBreakpoints(params.prompt),
    }),
  };
}

/**
 * 协议门控包装：anthropic 协议叠加缓存断点中间件，其余协议原样透传
 * （openai 走服务端自动前缀缓存，无需标记）。
 */
export function withCacheBreakpointWrapper(
  spec: { protocol?: string },
  base: LanguageModel
): LanguageModel {
  return spec.protocol === "anthropic"
    ? wrapLanguageModel({ model: base, middleware: anthropicCacheBreakpointMiddleware() })
    : base;
}
