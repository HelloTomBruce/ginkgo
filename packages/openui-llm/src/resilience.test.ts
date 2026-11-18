// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyProviderError,
  isRetriableErrorClass,
  parseRetryAfterMs,
  resolveResiliencePolicy,
  createResilientFetch,
  type ResolvedResiliencePolicy,
} from "./resilience";

/** 测试用已解析策略(等价于 resolveResiliencePolicy 的产出形态) */
function policy(over: Partial<ResolvedResiliencePolicy> = {}): ResolvedResiliencePolicy {
  return {
    maxRetries: 2,
    backoffBaseMs: 1000,
    requestTimeoutMs: 60_000,
    fallbacks: [],
    ...over,
  };
}

describe("classifyProviderError（9.1 错误分类器）", () => {
  it("401/403 → auth;400/404/422 → bad_request;429 → rate_limit;500/502/503/529 → server", () => {
    expect(classifyProviderError(new Response("", { status: 401 }))).toBe("auth");
    expect(classifyProviderError(new Response("", { status: 403 }))).toBe("auth");
    expect(classifyProviderError(new Response("", { status: 400 }))).toBe("bad_request");
    expect(classifyProviderError(new Response("", { status: 404 }))).toBe("bad_request");
    expect(classifyProviderError(new Response("", { status: 422 }))).toBe("bad_request");
    expect(classifyProviderError(new Response("", { status: 429 }))).toBe("rate_limit");
    expect(classifyProviderError(new Response("", { status: 500 }))).toBe("server");
    expect(classifyProviderError(new Response("", { status: 502 }))).toBe("server");
    expect(classifyProviderError(new Response("", { status: 503 }))).toBe("server");
    expect(classifyProviderError(new Response("", { status: 529 }))).toBe("server");
  });

  it("400 且 message 含 context length → context_overflow(AI SDK APICallError 形态)", () => {
    const err = Object.assign(
      new Error("This model's maximum context length is 4096 tokens. Please reduce the length."),
      { statusCode: 400 }
    );
    expect(classifyProviderError(err)).toBe("context_overflow");
    // 400 但无 context length 语义仍属 bad_request
    expect(
      classifyProviderError(Object.assign(new Error("invalid temperature"), { statusCode: 400 }))
    ).toBe("bad_request");
  });

  it("ECONNREFUSED / TypeError(fetch reject)→ network;无法识别 → unknown", () => {
    expect(
      classifyProviderError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" }))
    ).toBe("network");
    expect(classifyProviderError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyProviderError(new Error("something odd"))).toBe("unknown");
    expect(classifyProviderError(new Response("", { status: 418 }))).toBe("unknown");
    expect(classifyProviderError(undefined)).toBe("unknown");
  });

  it("isRetriableErrorClass:rate_limit/server/network 可重试,其余不可", () => {
    expect(isRetriableErrorClass("rate_limit")).toBe(true);
    expect(isRetriableErrorClass("server")).toBe(true);
    expect(isRetriableErrorClass("network")).toBe(true);
    expect(isRetriableErrorClass("auth")).toBe(false);
    expect(isRetriableErrorClass("bad_request")).toBe(false);
    expect(isRetriableErrorClass("context_overflow")).toBe(false);
  });
});

describe("parseRetryAfterMs（9.1 429 Retry-After 解析）", () => {
  it("秒数 → ms;钳 0–60s", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("120")).toBe(60_000);
    expect(parseRetryAfterMs("-5")).toBe(0);
  });

  it("HTTP-date → 与 now 的差值,钳 0–60s", () => {
    const now = Date.parse("2024-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Wed, 01 Jan 2024 00:00:02 GMT", now)).toBe(2000);
    expect(parseRetryAfterMs("Wed, 01 Jan 2024 00:01:00 GMT", now)).toBe(60_000);
    expect(parseRetryAfterMs("Tue, 31 Dec 2023 23:59:59 GMT", now)).toBe(0);
  });

  it("非法值 → undefined", () => {
    expect(parseRetryAfterMs("not-a-date")).toBeUndefined();
    expect(parseRetryAfterMs("")).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });
});

describe("resolveResiliencePolicy（9.4 三层配置回退）", () => {
  const ENV_KEYS = ["LLM_MAX_RETRIES", "LLM_REQUEST_TIMEOUT_MS", "LLM_FALLBACK_MODELS"];
  const savedEnv: Record<string, string | undefined> = {};

  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("缺省:maxRetries=2、backoffBaseMs=1000、requestTimeoutMs=60s、无 fallback", () => {
    const p = resolveResiliencePolicy();
    expect(p).toEqual({
      maxRetries: 2,
      backoffBaseMs: 1000,
      requestTimeoutMs: 60_000,
      fallbacks: [],
    });
  });

  it("环境变量兜底且钳制:LLM_MAX_RETRIES 0–5、LLM_REQUEST_TIMEOUT_MS 5s–300s", () => {
    process.env.LLM_MAX_RETRIES = "99";
    process.env.LLM_REQUEST_TIMEOUT_MS = "100";
    let p = resolveResiliencePolicy();
    expect(p.maxRetries).toBe(5);
    expect(p.requestTimeoutMs).toBe(5000);

    process.env.LLM_MAX_RETRIES = "-1";
    process.env.LLM_REQUEST_TIMEOUT_MS = "99999999";
    p = resolveResiliencePolicy();
    expect(p.maxRetries).toBe(0);
    expect(p.requestTimeoutMs).toBe(300_000);
  });

  it("请求体 resilience 优先于环境变量", () => {
    process.env.LLM_MAX_RETRIES = "4";
    process.env.LLM_REQUEST_TIMEOUT_MS = "120000";
    const p = resolveResiliencePolicy({ maxRetries: 1, requestTimeoutMs: 30_000 });
    expect(p.maxRetries).toBe(1);
    expect(p.requestTimeoutMs).toBe(30_000);
  });

  it("LLM_FALLBACK_MODELS 解析 JSON 数组;非法 JSON 回落空", () => {
    process.env.LLM_FALLBACK_MODELS = JSON.stringify([
      { model: "env-backup", apiKey: "k2", baseURL: "http://b.example/v1", protocol: "openai" },
    ]);
    expect(resolveResiliencePolicy().fallbacks).toEqual([
      { model: "env-backup", apiKey: "k2", baseURL: "http://b.example/v1", protocol: "openai" },
    ]);

    process.env.LLM_FALLBACK_MODELS = "{not json";
    expect(resolveResiliencePolicy().fallbacks).toEqual([]);
  });

  it("请求体 fallbacks 校验:丢弃非法条目,缺省字段不补", () => {
    const p = resolveResiliencePolicy({
      fallbacks: [
        { model: "ok-model" },
        { apiKey: "no-model" } as never,
        "bare-string" as never,
        { model: "with-proto", protocol: "anthropic" },
      ],
    });
    expect(p.fallbacks).toEqual([
      { model: "ok-model" },
      { model: "with-proto", protocol: "anthropic" },
    ]);
    // 请求体空数组优先于环境变量(显式关闭 fallback)
    process.env.LLM_FALLBACK_MODELS = JSON.stringify([{ model: "env-backup" }]);
    expect(resolveResiliencePolicy({ fallbacks: [] }).fallbacks).toEqual([]);
  });

  it("非对象 override 按缺省处理", () => {
    expect(resolveResiliencePolicy("junk" as never).maxRetries).toBe(2);
  });
});

describe("createResilientFetch（9.2 退避重试 + 首字节超时）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("先两次 500 后 200:重试至成功,共调用 3 次", async () => {
    vi.useFakeTimers();
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const f = createResilientFetch(baseFetch as never, policy());

    const p = f("http://api.example/v1/chat/completions");
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await p;

    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it("429 带 Retry-After: 2 时等待 ≥2s 再重试(fake timers)", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "2" } })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const f = createResilientFetch(baseFetch as never, policy(), {
      onRetry: (info: { delayMs: number }) => delays.push(info.delayMs),
    });

    let settled = false;
    const p = f("http://api.example/v1/chat/completions").then((r: Response) => {
      settled = true;
      return r;
    });
    // 2s 以内不得完成(Retry-After 未被尊重则此处会提前 resolve)
    await vi.advanceTimersByTimeAsync(1999);
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);

    const res = await p;
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(delays[0]).toBeGreaterThanOrEqual(2000);
  });

  it("非可重试 401:不重试,原样返回响应", async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const f = createResilientFetch(baseFetch as never, policy());

    const res = await f("http://api.example/v1/chat/completions");
    expect(res.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("可重试错误用尽重试:返回最后一次失败响应,调用 maxRetries+1 次", async () => {
    vi.useFakeTimers();
    const baseFetch = vi.fn().mockResolvedValue(new Response("err", { status: 503 }));
    const f = createResilientFetch(baseFetch as never, policy({ maxRetries: 2 }));

    const p = f("http://api.example/v1/chat/completions");
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    expect(res.status).toBe(503);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it("maxRetries=0 时不重试", async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response("err", { status: 500 }));
    const f = createResilientFetch(baseFetch as never, policy({ maxRetries: 0 }));

    const res = await f("http://api.example/v1/chat/completions");
    expect(res.status).toBe(500);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("fetch reject(ECONNREFUSED)按 network 重试", async () => {
    vi.useFakeTimers();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const f = createResilientFetch(baseFetch as never, policy());

    const p = f("http://api.example/v1/chat/completions");
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await p;

    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it("重试用尽后 fetch reject 抛出最后一次错误", async () => {
    vi.useFakeTimers();
    const lastErr = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const baseFetch = vi.fn().mockRejectedValue(lastErr);
    const f = createResilientFetch(baseFetch as never, policy({ maxRetries: 1 }));

    const p = f("http://api.example/v1/chat/completions");
    // 先附加 rejection 断言,避免 fake timers 推进期间出现未捕获 rejection
    const assertion = expect(p).rejects.toBe(lastErr);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it("首字节超时(请求超时未响应)按 network 重试", async () => {
    vi.useFakeTimers();
    const baseFetch = vi
      .fn()
      // 第一次:挂起不响应,直到被 abort
      .mockImplementationOnce(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new TypeError("fetch failed"))
            );
          })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const f = createResilientFetch(baseFetch as never, policy({ requestTimeoutMs: 5000 }));

    const p = f("http://api.example/v1/chat/completions");
    // 5000ms 超时 + 退避(1000ms+jitter≤500ms):推进 10s 覆盖第二次发起
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await p;

    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it("调用方主动 abort:立即抛出,不重试", async () => {
    const baseFetch = vi.fn().mockRejectedValue(new Error("should not retry"));
    const f = createResilientFetch(baseFetch as never, policy());
    const controller = new AbortController();
    controller.abort();

    await expect(
      f("http://api.example/v1/chat/completions", { signal: controller.signal })
    ).rejects.toThrow("should not retry");
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("每次重试经 onRetry 回调上报(遥测接缝)", async () => {
    vi.useFakeTimers();
    const retries: Array<{ attempt: number; errorClass: string }> = [];
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const f = createResilientFetch(baseFetch as never, policy(), {
      onRetry: (info: { attempt: number; errorClass: string }) =>
        retries.push({ attempt: info.attempt, errorClass: info.errorClass }),
    });

    const p = f("http://api.example/v1/chat/completions");
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(retries).toEqual([{ attempt: 1, errorClass: "server" }]);
  });
});
