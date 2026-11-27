import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Provider 装配：身份头（自动）+ 用户自定义头（优先）。
 *
 * 身份头按 baseURL 的 host 自动决定（opencode / openrouter / nvidia / 通用），
 * 用户配置的同名头覆盖默认值——与 DSH（pi-ai）的合并契约一致。
 */

const createOpenAISpy = vi.fn();
const createAnthropicSpy = vi.fn();

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: unknown) => {
    createOpenAISpy(opts);
    return (model: string) => ({ modelId: model, provider: "openai-mock" });
  },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (opts: unknown) => {
    createAnthropicSpy(opts);
    return (model: string) => ({ modelId: model, provider: "anthropic-mock" });
  },
}));

vi.mock("../reasoning/reasoningStream", () => ({
  createReasoningFetch: (baseFetch: unknown) => baseFetch,
}));

vi.mock("./resilience", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./resilience")>();
  return {
    ...actual,
    createResilientFetch: (baseFetch: unknown) => baseFetch,
    resolveResiliencePolicy: () => undefined,
  };
});

const { buildLanguageModel } = await import("./factory");

const lastOpenAIHeaders = () =>
  (createOpenAISpy.mock.calls.at(-1)?.[0] as Record<string, unknown>)?.headers as
    | Record<string, string>
    | undefined;

describe("buildLanguageModel 身份头与自定义头", () => {
  beforeEach(() => {
    createOpenAISpy.mockClear();
    createAnthropicSpy.mockClear();
  });

  it("通用端点：只带自动 User-Agent", () => {
    buildLanguageModel({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      protocol: "openai",
    });

    const headers = lastOpenAIHeaders();
    // 版本必须是真实 semver——unknown 说明版本导入链断了
    expect(headers?.["User-Agent"]).toMatch(/^ginkgo\/\d+\.\d+\.\d+ \(/);
    expect(headers?.["x-opencode-session"]).toBeUndefined();
  });

  it("opencode 端点：自动带 x-opencode-client 与 x-opencode-session（零配置）", () => {
    buildLanguageModel({
      model: "deepseek-v4.1-flash",
      apiKey: "sk-test",
      baseURL: "https://opencode.ai/inference/go/openai/v1",
      protocol: "openai",
      sessionId: "sess_auto_1",
    });

    const headers = lastOpenAIHeaders();
    expect(headers?.["x-opencode-client"]).toBe("ginkgo");
    expect(headers?.["x-opencode-session"]).toBe("sess_auto_1");
  });

  it("opencode 端点但无 sessionId 时不发空的 session 头", () => {
    buildLanguageModel({
      model: "m",
      apiKey: "sk-test",
      baseURL: "https://opencode.ai/inference/go/openai/v1",
      protocol: "openai",
    });

    const headers = lastOpenAIHeaders();
    expect(headers?.["x-opencode-client"]).toBe("ginkgo");
    expect("x-opencode-session" in (headers ?? {})).toBe(false);
  });

  it("openrouter 端点：带 HTTP-Referer 与 X-OpenRouter-Title", () => {
    buildLanguageModel({
      model: "m",
      apiKey: "sk-test",
      baseURL: "https://openrouter.ai/api/v1",
      protocol: "openai",
    });

    const headers = lastOpenAIHeaders();
    expect(headers?.["HTTP-Referer"]).toBeDefined();
    expect(headers?.["X-OpenRouter-Title"]).toBe("ginkgo");
  });

  it("nvidia 端点：X-BILLING-INVOKE-ORIGIN 首字母大写", () => {
    buildLanguageModel({
      model: "m",
      apiKey: "sk-test",
      baseURL: "https://integrate.api.nvidia.com/v1",
      protocol: "openai",
    });

    expect(lastOpenAIHeaders()?.["X-BILLING-INVOKE-ORIGIN"]).toBe("Ginkgo");
  });

  it("用户自定义头覆盖默认身份头（大小写不敏感）", () => {
    buildLanguageModel({
      model: "m",
      apiKey: "sk-test",
      baseURL: "https://opencode.ai/inference/go/openai/v1",
      protocol: "openai",
      sessionId: "sess_auto",
      headers: {
        "user-agent": "my-agent/2.0",
        "x-opencode-session": "user-provided",
      },
    });

    const headers = lastOpenAIHeaders() ?? {};
    expect(headers["user-agent"]).toBe("my-agent/2.0");
    // 不应同时残留默认的 User-Agent（大小写不同但同名）
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers["x-opencode-session"]).toBe("user-provided");
  });

  it("anthropic 协议同样走身份层", () => {
    buildLanguageModel({
      model: "claude-x",
      apiKey: "sk-test",
      baseURL: "https://api.anthropic.com",
      protocol: "anthropic",
      sessionId: "s1",
    });

    const opts = createAnthropicSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const headers = opts.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^ginkgo\/\d+\.\d+\.\d+ \(/);
  });
});
