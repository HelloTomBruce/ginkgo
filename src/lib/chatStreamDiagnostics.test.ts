import { describe, it, expect, vi } from "vitest";
import {
  buildStreamErrorMessage,
  createChatStreamFetch,
  formatElapsed,
  isAbortError,
  resolveStreamMeta,
  type ChatRequestMetadata,
} from "./chatStreamDiagnostics";

describe("chatStreamDiagnostics 纯函数", () => {
  it("formatElapsed: 秒级/分钟级/未知三档格式化", () => {
    expect(formatElapsed(undefined)).toBe("未知");
    expect(formatElapsed(1500)).toBe("1.5s");
    expect(formatElapsed(125000)).toBe("2.1m (125.0s)");
  });

  it("isAbortError: 用户主动中止与网络错误区分", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error("request aborted by user"))).toBe(true);
    expect(isAbortError(new TypeError("network error"))).toBe(false);
  });

  it("buildStreamErrorMessage: 通用网络错误按耗时分档，业务错误透传", () => {
    expect(buildStreamErrorMessage(new TypeError("network error"), 1500)).toContain(
      "网络响应中断"
    );
    expect(buildStreamErrorMessage(new TypeError("network error"), 125000)).toContain(
      "网络连接超时中断"
    );
    expect(buildStreamErrorMessage(new Error("模型配额不足"), 100)).toBe(
      "响应异常：模型配额不足"
    );
    expect(buildStreamErrorMessage(new Error("An error occurred."), undefined)).toContain(
      "网络响应中断"
    );
  });

  it("resolveStreamMeta: requestMeta 优先，无则回退最近一次请求记录并按 startTime 推算耗时", () => {
    const meta: ChatRequestMetadata = {
      startTime: Date.now() - 5000,
      url: "/api/analyze",
      method: "POST",
      appId: "analytics",
      model: "gpt-x",
    };
    const err = new Error("boom") as Error & { requestMeta?: ChatRequestMetadata; elapsedMs?: number };

    // 无挂载 → 回退最近请求记录
    const r1 = resolveStreamMeta(err, meta);
    expect(r1.meta).toBe(meta);
    expect(r1.elapsedMs).toBeGreaterThanOrEqual(4000);

    // 挂载 requestMeta → 优先
    err.requestMeta = { ...meta, startTime: Date.now() - 1000 };
    err.elapsedMs = 1234;
    const r2 = resolveStreamMeta(err, meta);
    expect(r2.meta).toBe(err.requestMeta);
    expect(r2.elapsedMs).toBe(1234);
  });
});

describe("createChatStreamFetch", () => {
  const makeInit = (body: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body),
  });

  it("非 2xx 响应抛出携带 status/耗时/requestMeta 的 ChatStreamError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":"quota"}', { status: 429, statusText: "Too Many Requests" })
    );
    const onMeta = vi.fn();
    const enhanced = createChatStreamFetch({
      getContext: () => ({ sessionId: "s1", appId: "analytics", model: "m1" }),
      onMeta,
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(
        enhanced("/api/analyze", makeInit({ messages: [{ content: "分析近30天趋势，超出80字符的内容会被截断——这里是填充文本，用于验证promptSnippet切片" }] }))
      ).rejects.toThrow(/\[HTTP 429/);
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(onMeta).toHaveBeenCalledTimes(1);
    const meta = onMeta.mock.calls[0][0];
    expect(meta.appId).toBe("analytics");
    expect(meta.sessionId).toBe("s1");
    expect(meta.promptSnippet!.length).toBeLessThanOrEqual(80);
  });

  it("网络层异常同样挂载耗时与元数据后原样抛出", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const onMeta = vi.fn();
    const enhanced = createChatStreamFetch({
      getContext: () => ({ appId: "design", model: "m2" }),
      onMeta,
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let caught: unknown = null;
    try {
      await enhanced("/api/analyze", makeInit({ messages: [] }));
    } catch (err) {
      caught = err;
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error & { requestMeta?: unknown }).requestMeta).toBeDefined();
    expect((caught as Error & { elapsedMs?: number }).elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
