import { describe, it, expect } from "vitest";
import type { LanguageModel } from "ai";
import { HarnessPipeline, type HarnessContext } from "./pipeline";
import { createConsoleSink } from "../telemetry/telemetry";

function createMockContext(): HarnessContext {
  return {
    runId: "run-test-123",
    tenantId: "tenant-a",
    sessionId: "sess-1",
    telemetry: createConsoleSink(),
    modelSpec: {
      model: "test-model",
      apiKey: "mock-key",
      baseURL: "https://api.openai.com/v1",
      protocol: "openai",
    },
    languageModel: {} as unknown as LanguageModel,
    systemPrompt: "hello",
    messages: [],
    tools: {},
    state: {},
  };
}

describe("HarnessPipeline 洋葱模型中间件管道", () => {
  it("按洋葱模型顺序执行（先进后出）", async () => {
    const pipeline = new HarnessPipeline();
    const trace: string[] = [];

    pipeline.use(async (_ctx, next) => {
      trace.push("m1-pre");
      await next();
      trace.push("m1-post");
    });

    pipeline.use(async (_ctx, next) => {
      trace.push("m2-pre");
      await next();
      trace.push("m2-post");
    });

    const ctx = createMockContext();
    await pipeline.run(ctx);

    expect(trace).toEqual(["m1-pre", "m2-pre", "m2-post", "m1-post"]);
  });

  it("支持中间件短路拦截（不调用 next）", async () => {
    const pipeline = new HarnessPipeline();
    const trace: string[] = [];

    pipeline.use(async (ctx) => {
      trace.push("m1-short-circuit");
      ctx.response = new Response("blocked", { status: 403 });
    });

    pipeline.use(async () => {
      trace.push("m2-should-not-run");
    });

    const ctx = createMockContext();
    await pipeline.run(ctx);

    expect(trace).toEqual(["m1-short-circuit"]);
    expect(ctx.response?.status).toBe(403);
  });

  it("禁止同一中间件多次调用 next()", async () => {
    const pipeline = new HarnessPipeline();

    pipeline.use(async (_ctx, next) => {
      await next();
      await next();
    });

    const ctx = createMockContext();
    await expect(pipeline.run(ctx)).rejects.toThrow("next() called multiple times");
  });

  it("支持对象形态中间件 (HarnessMiddleware)", async () => {
    const pipeline = new HarnessPipeline();
    const trace: string[] = [];

    pipeline.use({
      name: "object-middleware",
      execute: async (_ctx, next) => {
        trace.push("obj-pre");
        await next();
        trace.push("obj-post");
      },
    });

    const ctx = createMockContext();
    await pipeline.run(ctx);

    expect(trace).toEqual(["obj-pre", "obj-post"]);
  });

  it("中间件抛出异常可被外层捕获", async () => {
    const pipeline = new HarnessPipeline();

    pipeline.use(async () => {
      throw new Error("pipeline failure");
    });

    const ctx = createMockContext();
    await expect(pipeline.run(ctx)).rejects.toThrow("pipeline failure");
  });
});
