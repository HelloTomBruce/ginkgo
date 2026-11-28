// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { LanguageModel } from "ai";
import {
  applyAnthropicCacheBreakpoints,
  anthropicCacheBreakpointMiddleware,
  withCacheBreakpointWrapper,
} from "./cacheBreakpoints";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const userTextPrompt = (...texts: string[]): any[] =>
  texts.map((text) => ({ role: "user", content: [{ type: "text", text }] }));

describe("applyAnthropicCacheBreakpoints 滑动断点标记", () => {
  it("空 prompt 原样返回（同引用）", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty: any[] = [];
    expect(applyAnthropicCacheBreakpoints(empty)).toBe(empty);
  });

  it("最后一条消息被打上 cacheControl 标记，其余消息同引用透传", () => {
    const prompt = userTextPrompt("第一条", "第二条", "第三条（最新输入）");
    const out = applyAnthropicCacheBreakpoints(prompt);

    expect(out.length).toBe(3);
    expect(out[0]).toBe(prompt[0]); // 其余消息同引用透传
    expect(out[1]).toBe(prompt[1]);
    const marked = out[2] as {
      content: unknown;
      providerMetadata?: Record<string, unknown>;
    };
    expect(marked).not.toBe(prompt[2]); // 目标消息被克隆
    expect(marked.providerMetadata).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    // content 不被改动
    expect(marked.content).toEqual(prompt[2].content);
  });

  it("原数组零污染（存储层历史不动契约）", () => {
    const prompt = userTextPrompt("a", "b");
    const snapshot = JSON.parse(JSON.stringify(prompt));
    applyAnthropicCacheBreakpoints(prompt);
    expect(prompt).toEqual(snapshot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prompt[1] as any).providerMetadata).toBeUndefined();
  });

  it("system 消息场景：标记落最后一条（前缀 tools+system+首问整体入缓存）", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt: any[] = [
      { role: "system", content: "你是一个助手" },
      { role: "user", content: [{ type: "text", text: "问题" }] },
    ];
    const out = applyAnthropicCacheBreakpoints(prompt);
    const marked = out[1] as { providerMetadata?: Record<string, unknown> };
    expect(marked.providerMetadata?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
    expect(out[0]).toBe(prompt[0]);
  });

  it("已有 providerMetadata 时合并保留其他 provider key", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt: any[] = [
      { role: "user", content: [{ type: "text", text: "x" }] },
      { role: "user", content: [{ type: "text", text: "y" }], providerMetadata: { openai: { foo: "bar" } } },
    ];
    const out = applyAnthropicCacheBreakpoints(prompt);
    const marked = out[1] as { providerMetadata?: Record<string, unknown> };
    expect(marked.providerMetadata?.openai).toEqual({ foo: "bar" });
    expect(marked.providerMetadata?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
  });
});

describe("anthropicCacheBreakpointMiddleware", () => {
  it("transformParams 对每次调用改写最终 prompt（覆盖 SDK 流内追加的 responseMessages）", async () => {
    const middleware = anthropicCacheBreakpointMiddleware();
    const prompt = userTextPrompt("任务", "tool_result");
    const out = await middleware.transformParams?.({
      type: "stream",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: { prompt, temperature: 0.2 } as any,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markedLast = (out?.prompt as any).at(-1);
    expect(markedLast.providerMetadata?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
  });
});

describe("withCacheBreakpointWrapper 协议门控", () => {
  it("openai 协议原样透传（同引用，零包装）", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = { modelId: "gpt-4o" } as any as LanguageModel;
    const out = withCacheBreakpointWrapper({ protocol: "openai" }, base);
    expect(out).toBe(base);
  });

  it("anthropic 协议返回包装后的新模型实例", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = { modelId: "claude-sonnet-4-5" } as any as LanguageModel;
    const out = withCacheBreakpointWrapper({ protocol: "anthropic" }, base);
    expect(out).not.toBe(base);
    expect(out.modelId).toBe("claude-sonnet-4-5");
  });
});
