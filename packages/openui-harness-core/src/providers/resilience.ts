/**
 * Provider 韧性层（WS-9）：错误分类 → 指数退避重试（尊重 Retry-After）→
 * handler 层模型 fallback 链。对标 LiteLLM Router 的 num_retries + fallbacks 语义。
 *
 * 诚实的重试边界：只重试「流产出第一个 content 分块之前」的失败。
 * - HTTP 层失败（非 2xx 响应 / fetch reject / 首字节前超时）在本模块内按分类退避重试；
 * - 流已开始吐字后的失败不做透明重跑（客户端已见部分内容，重跑会重复输出），
 *   由 handler 层发 MID_STREAM_FAILURE 遥测后按既有 onError 路径报错；
 * - fallback 不在 fetch 层而在 handler 层：主模型重试用尽后按序切换 ModelSpec
 *   重建 languageModel 并重发整个 streamText（前提仍是未产出任何 content 分块）。
 *
 * 配置来源（零硬编码，三层回退）：请求体 resilience ＞
 * 环境变量 LLM_FALLBACK_MODELS / LLM_MAX_RETRIES / LLM_REQUEST_TIMEOUT_MS ＞ 缺省。
 *
 * 本模块为包内部件（与 telemetry.ts 同级），不对外导出。
 */

/** 错误分类：决定重试与 fallback 策略 */
export type ProviderErrorClass =
  | "auth" // 401/403 — 不重试不 fallback（凭证问题，重试无意义）
  | "bad_request" // 400/404/422 — 不重试不 fallback（请求本身非法）
  | "context_overflow" // 400 且 message 含 context length — 不重试；可 fallback 到更大窗模型
  | "rate_limit" // 429 — 重试（读 Retry-After）→ 用尽后 fallback
  | "server" // 500/502/503/529 overloaded — 重试 → fallback
  | "network" // fetch reject / SSE 首字节前连接中断 — 重试 → fallback
  | "unknown";

export interface ModelSpec {
  model: string;
  apiKey?: string; // 缺省沿用主请求凭证
  baseURL?: string; // 缺省沿用主请求 baseURL
  protocol?: "openai" | "anthropic"; // 缺省沿用主请求协议
}

export interface ResiliencePolicy {
  /** 单模型最大重试次数（不含首次），缺省 2；钳 0–5 */
  maxRetries?: number;
  /** 退避基数 ms，缺省 1000；实际等待 = base * 2^n + jitter(0–500ms) */
  backoffBaseMs?: number;
  /** 单次 HTTP 请求超时（首字节前），缺省 60s；钳 5s–300s */
  requestTimeoutMs?: number;
  /** 失败切换的候选模型链，按序尝试；缺省空（不 fallback） */
  fallbacks?: ModelSpec[];
}

/** 环境变量与钳制缺省（handler 与测试共用同一事实来源） */
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES_LIMIT = 5;
export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const REQUEST_TIMEOUT_MIN_MS = 5_000;
export const REQUEST_TIMEOUT_MAX_MS = 300_000;
/** Retry-After 头（秒数或 HTTP-date）解析结果钳制上限 */
export const RETRY_AFTER_MAX_MS = 60_000;
const JITTER_MAX_MS = 500;

/** undici/Node 网络层错误码：命中即视为 network 类（可重试） */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function classifyStatus(status: number, message: string): ProviderErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 500 || status === 502 || status === 503 || status === 529) return "server";
  if (status === 400) return /context length/i.test(message) ? "context_overflow" : "bad_request";
  if (status === 404 || status === 422) return "bad_request";
  return "unknown";
}

/**
 * 错误分类器（9.1）：接受 AI SDK 抛出的异常（APICallError 带 statusCode/message）
 * 或裸 Response。网络层错误（fetch reject 的 TypeError、undici 错误码、cause 链）归为 network。
 */
export function classifyProviderError(input: unknown): ProviderErrorClass {
  if (input instanceof Response) {
    return classifyStatus(input.status, "");
  }
  if (input === null || input === undefined) return "unknown";
  const err = input as {
    statusCode?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
  };
  const message = typeof err.message === "string" ? err.message : String(input);
  if (typeof err.statusCode === "number") {
    return classifyStatus(err.statusCode, message);
  }
  if (input instanceof TypeError) return "network";
  if (typeof err.code === "string" && NETWORK_ERROR_CODES.has(err.code)) return "network";
  const cause = err.cause;
  if (cause instanceof TypeError) return "network";
  if (
    cause !== null &&
    typeof cause === "object" &&
    typeof (cause as { code?: unknown }).code === "string" &&
    NETWORK_ERROR_CODES.has((cause as { code: string }).code)
  ) {
    return "network";
  }
  return "unknown";
}

/** 可重试分类：rate_limit/server/network（auth/bad_request/context_overflow/unknown 不重试） */
export function isRetriableErrorClass(errorClass: ProviderErrorClass): boolean {
  return errorClass === "rate_limit" || errorClass === "server" || errorClass === "network";
}

/**
 * 解析 Retry-After 头（秒数或 HTTP-date），结果钳 0–60s；非法值返回 undefined
 * （调用方回落到指数退避）。now 可注入以便测试 HTTP-date 分支。
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now()
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds, 0) * 1000, RETRY_AFTER_MAX_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - now, 0), RETRY_AFTER_MAX_MS);
  }
  return undefined;
}

/**
 * handler 模型链上的已解析 ModelSpec：fallback 缺省字段已回落主请求值，
 * 可直接用于 provider 装配（凭证护栏在链构建前先行拦截非法组合）。
 */
export interface ResolvedModelSpec {
  model: string;
  apiKey: string;
  baseURL: string;
  protocol: "openai" | "anthropic";
}

/** 已解析（钳制 + 校验）的韧性策略：fetch 层与 handler 层消费同一形态 */
export interface ResolvedResiliencePolicy {
  maxRetries: number;
  backoffBaseMs: number;
  requestTimeoutMs: number;
  fallbacks: ModelSpec[];
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 校验单条 fallback 条目：model 必须是字符串；其余字段类型不符则丢弃（回落主请求值） */
function normalizeModelSpec(entry: unknown): ModelSpec | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  if (typeof e.model !== "string" || e.model.length === 0) return undefined;
  const spec: ModelSpec = { model: e.model };
  if (typeof e.apiKey === "string" && e.apiKey.length > 0) spec.apiKey = e.apiKey;
  if (typeof e.baseURL === "string" && e.baseURL.length > 0) spec.baseURL = e.baseURL;
  if (e.protocol === "openai" || e.protocol === "anthropic") {
    spec.protocol = e.protocol;
  }
  return spec;
}

/**
 * 韧性策略解析（9.4）：请求体 resilience ＞ 环境变量 ＞ 缺省。
 * - LLM_MAX_RETRIES 缺省 2，钳 0–5
 * - LLM_REQUEST_TIMEOUT_MS 缺省 60000，钳 5000–300000
 * - LLM_FALLBACK_MODELS 为 JSON 数组；请求体 fallbacks（含显式空数组）优先
 */
export function resolveResiliencePolicy(override?: unknown): ResolvedResiliencePolicy {
  const body =
    override && typeof override === "object" ? (override as Partial<ResiliencePolicy>) : {};

  const envRetries = toFiniteNumber(process.env.LLM_MAX_RETRIES);
  const retriesRaw =
    toFiniteNumber(body.maxRetries) ?? envRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetries = Math.min(Math.max(Math.round(retriesRaw), 0), MAX_RETRIES_LIMIT);

  const backoffRaw = toFiniteNumber(body.backoffBaseMs) ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffBaseMs = Math.max(Math.round(backoffRaw), 0);

  const envTimeout = toFiniteNumber(process.env.LLM_REQUEST_TIMEOUT_MS);
  const timeoutRaw =
    toFiniteNumber(body.requestTimeoutMs) ?? envTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = Math.min(
    Math.max(Math.round(timeoutRaw), REQUEST_TIMEOUT_MIN_MS),
    REQUEST_TIMEOUT_MAX_MS
  );

  let fallbacks: ModelSpec[] | undefined;
  if (Array.isArray(body.fallbacks)) {
    fallbacks = body.fallbacks
      .map(normalizeModelSpec)
      .filter((s): s is ModelSpec => s !== undefined);
  } else {
    try {
      const parsed: unknown = process.env.LLM_FALLBACK_MODELS
        ? JSON.parse(process.env.LLM_FALLBACK_MODELS)
        : undefined;
      if (Array.isArray(parsed)) {
        fallbacks = parsed
          .map(normalizeModelSpec)
          .filter((s): s is ModelSpec => s !== undefined);
      }
    } catch {
      // 非法 JSON 按未配置处理（不阻断主请求）
    }
  }

  return { maxRetries, backoffBaseMs, requestTimeoutMs, fallbacks: fallbacks ?? [] };
}

/** createResilientFetch 的遥测/测试接缝 */
export interface ResilientFetchHooks {
  /** 每次退避重试前回调（attempt 从 1 起计） */
  onRetry?: (info: {
    attempt: number;
    errorClass: ProviderErrorClass;
    delayMs: number;
    reason: string;
  }) => void;
  /** sleep 注入点：测试用 fake timers 驱动，缺省 setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

/** 组合调用方 signal 与超时 signal（任一触发即触发；与 handler.ts 的 anySignal 同款语义） */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const combined = new AbortController();
  a.addEventListener("abort", () => combined.abort(a.reason), { once: true });
  b.addEventListener("abort", () => combined.abort(b.reason), { once: true });
  return combined.signal;
}

/** 指数退避：base * 2^n + jitter(0–500ms) */
function backoffDelay(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * (JITTER_MAX_MS + 1));
}

/**
 * 韧性 fetch 包装（9.2）：包在 createReasoningFetch 之外，对每次 provider HTTP 调用
 * 提供「指数退避重试 + Retry-After 尊重 + 首字节前超时」。
 *
 * 语义：
 * - response.ok === false：按分类退避重试（429 读 Retry-After，与退避取大者）；
 *   非可重试分类（auth/bad_request/context_overflow/unknown）或重试用尽则原样返回响应，
 *   由 AI SDK 抛给上层（handler 据分类决定 fallback）。
 * - fetch reject：按 network 退避重试；调用方主动 abort 立即上抛（用户停止/预算熔断语义）。
 * - 超时：单次请求 requestTimeoutMs 内未返回响应即中止，按 network 重试。
 * - 成功（2xx）响应原样透传（SSE 体由内侧 reasoning 转换流处理）。
 */
export function createResilientFetch(
  baseFetch: typeof fetch,
  policy: Pick<ResolvedResiliencePolicy, "maxRetries" | "backoffBaseMs" | "requestTimeoutMs">,
  hooks: ResilientFetchHooks = {}
): typeof fetch {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ): Promise<Response> => {
    const callerSignal = init?.signal ?? undefined;
    for (let attempt = 0; ; attempt++) {
      const timeoutController = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, policy.requestTimeoutMs);
      const signal = callerSignal
        ? combineAbortSignals(callerSignal, timeoutController.signal)
        : timeoutController.signal;
      try {
        const response = await baseFetch(input, { ...init, signal });
        clearTimeout(timer);
        if (response.ok) return response;
        const errorClass = classifyProviderError(response);
        // 非可重试或重试用尽：原样返回，由 SDK 抛给上层做 fallback 判定
        if (!isRetriableErrorClass(errorClass) || attempt >= policy.maxRetries) {
          return response;
        }
        // 释放失败响应的连接
        void response.body?.cancel().catch(() => {});
        const backoff = backoffDelay(policy.backoffBaseMs, attempt);
        const retryAfterMs =
          errorClass === "rate_limit"
            ? parseRetryAfterMs(response.headers.get("retry-after"))
            : undefined;
        const delayMs = retryAfterMs !== undefined ? Math.max(retryAfterMs, backoff) : backoff;
        hooks.onRetry?.({
          attempt: attempt + 1,
          errorClass,
          delayMs,
          reason: `HTTP ${response.status}`,
        });
        await sleep(delayMs);
      } catch (err) {
        clearTimeout(timer);
        // 调用方主动中止：立即上抛，不做重试
        if (callerSignal?.aborted) throw err;
        const errorClass = timedOut ? "network" : classifyProviderError(err);
        if (!isRetriableErrorClass(errorClass) || attempt >= policy.maxRetries) throw err;
        const delayMs = backoffDelay(policy.backoffBaseMs, attempt);
        hooks.onRetry?.({
          attempt: attempt + 1,
          errorClass,
          delayMs,
          reason: err instanceof Error ? err.message : String(err),
        });
        await sleep(delayMs);
      }
    }
  }) as typeof fetch;
}
