// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnalyzeHandler, type SessionContextMeta, type SessionContextStore } from "./handler";
import {
  InMemoryTaskStore,
  InMemoryCostLedger,
  type ModelPricingTable,
  type MCPClientManager,
} from "@openui-analytics/harness-core";
import { streamText, generateText } from "ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    generateText: vi.fn(),
  };
});

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3006/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * 构造贴近真实 SDK 契约的 streamText mock 返回值：字节经 toDataStream 交付、读取时抛错。
 * 不能用 mergeIntoDataStream 同步 throw 的形态——真实 SDK 中 merge() 内部把错误吞成
 * data stream error part（ai@4.3.19 index.mjs merge() 实现），永不 reject；
 * fallback/MID_STREAM_FAILURE 逻辑消费的是会抛错的流迭代。
 */
function streamResult(handlers: {
  chunks?: string[];
  error?: unknown;
  onStart?: () => void;
}): ReturnType<typeof streamText> {
  return {
    toDataStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          handlers.onStart?.();
          const encoder = new TextEncoder();
          for (const chunk of handlers.chunks ?? []) {
            controller.enqueue(encoder.encode(chunk));
          }
          if (handlers.error !== undefined) {
            controller.error(handlers.error);
          } else {
            controller.close();
          }
        },
      }),
  } as unknown as ReturnType<typeof streamText>;
}

function mockStreamOk() {
  vi.mocked(streamText).mockReturnValue(streamResult({ chunks: ['0:"ok"\n'] }));
}

describe("createAnalyzeHandler", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
    POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("未配置 API Key 时返回合规 data stream 降级响应（引导「设置」）", async () => {
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const text = await res.text();
    expect(text).toContain("API Key");
    expect(text).toContain("「设置」");
  });

  it("应用工具装配失败时降级为空工具集并正常流式响应", async () => {
    POST = createAnalyzeHandler({
      resolveAppTools: async () => {
        throw new Error("connection refused");
      },
    });

    const res = await POST(makeRequest({ messages: [], apiKey: "test-key" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith("3:")).toBe(false);
  });

  it("客户端提供 baseURL 但未提供 apiKey 时拒绝", async () => {
    process.env.OPENAI_API_KEY = "server-secret-key";

    const res = await POST(
      makeRequest({ messages: [], baseURL: "http://attacker.example/v1" })
    );

    expect(res.status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("客户端 baseURL 与 apiKey 配对提供时正常放行", async () => {
    process.env.OPENAI_API_KEY = "server-secret-key";
    const res = await POST(
      makeRequest({
        messages: [],
        baseURL: "http://my-llm.example/v1",
        apiKey: "client-own-key",
      })
    );
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("temperature 越界时钳制到 0–2，缺省 0.2", async () => {
    await POST(makeRequest({ messages: [], apiKey: "k", temperature: 5 }));
    expect(vi.mocked(streamText).mock.calls[0][0]).toMatchObject({ temperature: 2 });

    await POST(makeRequest({ messages: [], apiKey: "k", temperature: -1 }));
    expect(vi.mocked(streamText).mock.calls[1][0]).toMatchObject({ temperature: 0 });

    await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(vi.mocked(streamText).mock.calls[2][0]).toMatchObject({ temperature: 0.2 });
  });

});

describe("createAnalyzeHandler 全动态装配", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("protocol=anthropic 时走 createAnthropic 且 baseURL 规范化补 /v1，不调 createOpenAI", async () => {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });

    await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        baseURL: "https://api.kimi.com/coding/",
        protocol: "anthropic",
      })
    );

    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "k",
        baseURL: "https://api.kimi.com/coding/v1",
      })
    );
    expect(createOpenAI).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("maxTokens：请求体优先并钳制 1024–65536；缺省 16384；env LLM_MAX_OUTPUT_TOKENS 兜底", async () => {
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });

    // 请求体超上限 → 钳到 65536
    await POST(makeRequest({ messages: [], apiKey: "k", maxTokens: 999999 }));
    expect(vi.mocked(streamText).mock.calls[0][0].maxTokens).toBe(65536);

    // 请求体低于下限 → 钳到 1024
    await POST(makeRequest({ messages: [], apiKey: "k", maxTokens: 100 }));
    expect(vi.mocked(streamText).mock.calls[1][0].maxTokens).toBe(1024);

    // 缺省 → 16384
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(vi.mocked(streamText).mock.calls[2][0].maxTokens).toBe(16384);

    // env 覆盖缺省
    process.env.LLM_MAX_OUTPUT_TOKENS = "32768";
    try {
      await POST(makeRequest({ messages: [], apiKey: "k" }));
      expect(vi.mocked(streamText).mock.calls[3][0].maxTokens).toBe(32768);
    } finally {
      delete process.env.LLM_MAX_OUTPUT_TOKENS;
    }
  });
});

describe("createAnalyzeHandler 上下文治理", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let POST: (req: Request) => Promise<Response>;
  let getContext: ReturnType<
    typeof vi.fn<SessionContextStore["getContext"]>
  >;
  let updateContext: ReturnType<
    typeof vi.fn<SessionContextStore["updateContext"]>
  >;

  const toolResultMsg = (toolName: string, len: number, id: string) => ({
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, toolName, result: "x".repeat(len) },
    ],
  });

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
    getContext = vi.fn(async () => undefined);
    updateContext = vi.fn(async () => {});
    POST = createAnalyzeHandler({
      sessions: { getContext, updateContext },
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("小历史：消息原样透传（直发路径）", async () => {
    const messages = [
      { role: "user", content: "分析 CAC" },
      { role: "assistant", content: "好的" },
    ];
    await POST(
      makeRequest({ messages, apiKey: "k", sessionId: "sess_ab12cd34" })
    );
    const sent = vi.mocked(streamText).mock.calls[0][0].messages;
    expect(sent).toEqual(messages);
  });

  it("onFinish：实测 promptTokens 回写会话元数据（token 锚点）", async () => {
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        apiKey: "k",
        sessionId: "sess_ab12cd34",
      })
    );
    const onFinish = vi.mocked(streamText).mock.calls[0][0].onFinish as (
      arg: unknown
    ) => void;
    onFinish({ usage: { promptTokens: 12345, completionTokens: 10 } });
    expect(updateContext).toHaveBeenCalledWith("sess_ab12cd34", {
      lastPromptTokens: 12345,
    });
  });

  it("多步工具调用：优先使用最后一步单步 promptTokens 而非累加值回写锚点", async () => {
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        apiKey: "k",
        sessionId: "sess_multi_step",
      })
    );
    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    const onStepFinish = callArgs.onStepFinish as (arg: unknown) => void;
    const onFinish = callArgs.onFinish as (arg: unknown) => void;

    // 模拟多步 step 1 与 step 2
    onStepFinish({ usage: { promptTokens: 10000, completionTokens: 100 } });
    onStepFinish({ usage: { promptTokens: 18000, completionTokens: 200 } });

    // AI SDK 汇总传入 onFinish 的是累加值 28000
    onFinish({ usage: { promptTokens: 28000, completionTokens: 300 } });

    // 必须回写最后一步的单步峰值 18000，而不是累加值 28000
    expect(updateContext).toHaveBeenCalledWith("sess_multi_step", {
      lastPromptTokens: 18000,
    });
  });

  it("无 sessionId：治理降级，不读写会话元数据", async () => {
    await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], apiKey: "k" })
    );
    expect(getContext).not.toHaveBeenCalled();
    const onFinish = vi.mocked(streamText).mock.calls[0][0].onFinish as (
      arg: unknown
    ) => void;
    onFinish({ usage: { promptTokens: 123 } });
    expect(updateContext).not.toHaveBeenCalled();
  });

  it("超阈值：窗口外 tool 结果裁剪为占位符，用户消息不动", async () => {
    // contextWindow=12288 + maxTokens=1024 → triggerAt=3072（夹具 ~5900 tokens；
    // 中立系统提示词远小于旧组件 kit 文档，窗口相应调小以触发水位）
    const messages = [
      { role: "user", content: "分析 CAC" },
      toolResultMsg("execute_sql", 6000, "c1"),
      toolResultMsg("describe_table", 6000, "c2"),
      { role: "assistant", content: "中间结论" },
      { role: "user", content: "y".repeat(6000) },
      toolResultMsg("list_tables", 2000, "c3"),
      { role: "user", content: "继续" },
    ];
    await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 12288,
        maxTokens: 1024,
      })
    );
    const sent = vi.mocked(streamText).mock.calls[0][0].messages as {
      role: string;
      content: { result?: string }[] | string;
    }[];
    const pruned = sent[1].content as { result: string }[];
    expect(pruned[0].result).toBe("[已裁剪: execute_sql]");
    // 用户消息原样
    expect(sent[0].content).toBe("分析 CAC");
    // 无摘要触发时 system 不含摘要段
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).not.toContain("此前会话摘要");
  });

  it("pruning 不足：触发 LLM 摘要并缓存；命中缓存不再生成", async () => {
    // 大量不可裁剪 user 消息：pruning 无效 → 摘要兜底
    const messages = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `u${i}`,
        role: "user",
        content: "u".repeat(7000) + i,
      })),
      { id: "latest", role: "user", content: "最新问题" },
    ];
    vi.mocked(generateText).mockResolvedValueOnce({
      text: " 缓存摘要内容 ",
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 12288,
        maxTokens: 1024,
      })
    );
    expect(generateText).toHaveBeenCalledTimes(1);
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("此前会话摘要");
    expect(sys).toContain("缓存摘要内容");
    // 摘要缓存写回（游标 = 覆盖区间末条消息 id）
    expect(updateContext).toHaveBeenCalledWith(
      "sess_ab12cd34",
      expect.objectContaining({ summary: "缓存摘要内容" })
    );
    // 摘要裁剪后消息数减少且首条为 user
    const sent = vi.mocked(streamText).mock.calls[0][0].messages as {
      role: string;
    }[];
    expect(sent.length).toBeLessThan(messages.length);
    expect(sent[0].role).toBe("user");

    // 第二次：摘要游标命中缓存 → 不再调用 generateText
    const coveredMarker = (
      updateContext.mock.calls[0][1] as { summaryUptoMessageId: string }
    ).summaryUptoMessageId;
    getContext.mockResolvedValueOnce({
      summary: "缓存摘要内容",
      summaryUptoMessageId: coveredMarker,
    });
    await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 12288,
        maxTokens: 1024,
      })
    );
    expect(generateText).toHaveBeenCalledTimes(1); // 未新增调用
    const sys2 = vi.mocked(streamText).mock.calls[1][0].system as string;
    expect(sys2).toContain("缓存摘要内容");
  });

  it("摘要生成失败：退化为 pruning 投影，不阻塞分析", async () => {
    const messages = [
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user",
        content: "u".repeat(7000) + i,
      })),
      { role: "user", content: "最新问题" },
    ];
    vi.mocked(generateText).mockRejectedValueOnce(new Error("llm down"));
    const res = await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 12288,
        maxTokens: 1024,
      })
    );
    expect(res.status).toBe(200);
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).not.toContain("此前会话摘要");
  });
});

describe("双重终态识别与步数预算", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  it("tools 始终装配 finish_task 显式终态工具", async () => {
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(arg.tools).toBeDefined();
    expect(Object.keys(arg.tools ?? {})).toContain("finish_task");
  });

  it("显式调用 finish_task(insufficient_data,不受产出门禁限制)触发 explicit 终态并返回确认消息", async () => {
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<unknown>;
    };
    expect(finishTool).toBeDefined();

    const result = (await finishTool.execute({
      status: "insufficient_data",
      summary: "数据不足",
    })) as {
      terminated: boolean;
      status: string;
      summary: string;
    };
    expect(result.terminated).toBe(true);
    expect(result.status).toBe("insufficient_data");
    expect(result.summary).toBe("数据不足");
  });

  it("未调用 finish_task 且模型正常 stop 时，触发 natural 终态兜底", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "stop",
            text: "分析完成",
            usage: { promptTokens: 5000, completionTokens: 100 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 5000 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    const text = await res.text();

    expect(text).toContain('"type":"task_finish"');
    expect(text).toContain('"termination":"natural"');
  });

  it("当因为达到上限截断时（finishReason=length），触发 step_limit_reached 终态", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "length",
            text: "被截断",
            usage: { promptTokens: 5000, completionTokens: 100 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 5000 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    const text = await res.text();

    expect(text).toContain('"type":"task_finish"');
    expect(text).toContain('"termination":"step_limit_reached"');
    expect(text).toContain('"status":"truncated"');
  });

  it("步数预算：请求体 maxSteps 与环境变量 LLM_MAX_STEPS 优先级", async () => {
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });

    // 请求体显式传 30
    await POST(makeRequest({ messages: [], apiKey: "k", maxSteps: 30 }));
    let arg = vi.mocked(streamText).mock.calls[0][0];
    expect(arg.maxSteps).toBe(30);

    // 环境变量 LLM_MAX_STEPS 覆盖默认值
    process.env.LLM_MAX_STEPS = "25";
    try {
      await POST(makeRequest({ messages: [], apiKey: "k" }));
      arg = vi.mocked(streamText).mock.calls[1][0];
      expect(arg.maxSteps).toBe(25);
    } finally {
      delete process.env.LLM_MAX_STEPS;
    }
  });

  it("流重连：正在运行的会话收到新请求时不重复调用 streamText，直接接入在途流", async () => {
    vi.mocked(streamText).mockClear();
    let finishStream: () => void;
    vi.mocked(streamText).mockReturnValue({
      toDataStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('0:"chunk1"\n'));
            void new Promise<void>((resolve) => {
              finishStream = resolve;
            }).then(() => {
              controller.enqueue(new TextEncoder().encode('0:"chunk2"\n'));
              controller.close();
            });
          },
        }),
    } as unknown as ReturnType<typeof streamText>);

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });

    // 第一次请求：启动后台流任务
    const res1 = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_recon_test" })
    );
    expect(res1.status).toBe(200);
    expect(await POST.isSessionRunning("sess_recon_test")).toBe(true);
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);

    // 第二次请求（模拟页面刷新后 reconnect）：
    const res2 = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_recon_test", reconnect: true })
    );
    expect(res2.status).toBe(200);
    // 不应重复触发 streamText
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);

    // 结束在途流
    finishStream!();

    // 显式 stop 任务
    const stopRes = await POST(
      makeRequest({ action: "stop", sessionId: "sess_recon_test" } as never)
    );
    const stopJson = await stopRes.json();
    expect(stopJson).toEqual({ ok: true, stopped: true });
    expect(await POST.isSessionRunning("sess_recon_test")).toBe(false);
  });
});

describe("WS-8 TaskStore 工厂接线", () => {
  afterEach(() => {
    delete process.env.LLM_TASK_STORE;
    delete process.env.LLM_TASK_STORE_DIR;
    vi.clearAllMocks();
  });

  it("显式 taskStore/instanceId 注入：新 hub 使用该存储并写入 owner 标识", async () => {
    mockStreamOk();
    const taskStore = new InMemoryTaskStore();
    const POST = createAnalyzeHandler({
      taskStore,
      instanceId: "handler-test:123",
    });

    const response = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_store_injected" })
    );
    await response.text();
    expect(await taskStore.get("anon:sess_store_injected")).toMatchObject({
      ownerInstanceId: "handler-test:123",
      status: "completed",
    });
  });

  it("LLM_TASK_STORE=file：handler 新实例从 LLM_TASK_STORE_DIR 恢复 completed 重放", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-handler-store-"));
    process.env.LLM_TASK_STORE = "file";
    process.env.LLM_TASK_STORE_DIR = dir;
    mockStreamOk();
    try {
      const firstPOST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
      const first = await firstPOST(
        makeRequest({ messages: [], apiKey: "k", sessionId: "sess_file_factory" })
      );
      const expected = await first.text();
      expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);

      const restartedPOST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
      const replay = await restartedPOST(
        makeRequest({
          messages: [],
          sessionId: "sess_file_factory",
          reconnect: true,
        })
      );
      expect(await replay.text()).toBe(expected);
      expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("任务中止传导（WS-2:abortTask → streamText abortSignal）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("streamText 接收任务 abortSignal;用户停止后 signal 被触发(取消 provider 生成/计费)", async () => {
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });

    // 发起会话任务(mock 流即刻完成,任务进 30s 终态保留窗,abortController 仍随 task 保留)
    await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_sig_test" })
    );
    const passedSignal = vi.mocked(streamText).mock.calls[0][0].abortSignal;
    expect(passedSignal).toBeDefined();
    expect(passedSignal?.aborted).toBe(false);

    // 用户显式停止:hub.abortTask 触发同一 controller
    const stopRes = await POST(
      makeRequest({ action: "stop", sessionId: "sess_sig_test" } as never)
    );
    expect(((await stopRes.json()) as { stopped?: boolean }).stopped).toBe(true);
    expect(passedSignal?.aborted).toBe(true);
  });
});

describe("成本预算与并发准入（WS-3）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "OPENAI_API_KEY",
      "LLM_API_KEY",
      "LLM_TASK_TOKEN_BUDGET",
      "LLM_MAX_CONCURRENT_TASKS",
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("累计 usage 超预算：写 budget_exhausted 终态恰一次、中止 provider、不发自然终态", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          // 两步各 600k,预算 10k(请求体钳制下限)→ 第一步即熔断
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "tool-calls",
            text: "",
            usage: { promptTokens: 400_000, completionTokens: 200_000 },
          } as never);
          opts.onFinish?.({
            usage: { promptTokens: 800_000, completionTokens: 400_000 },
          } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_budget", budgetTokens: 10_000 })
    );
    const text = await res.text();

    const finishChunks = text.split("\n").filter((l) => l.includes('"termination":"budget_exhausted"'));
    expect(finishChunks).toHaveLength(1);
    expect(text).not.toContain('"termination":"natural"');
    // 预算熔断触发 provider 中止
    const passedSignal = vi.mocked(streamText).mock.calls[0][0].abortSignal;
    expect(passedSignal?.aborted).toBe(true);
  });

  it("未超预算：不出现 budget_exhausted 终态(正常 natural 闭环)", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "stop",
            text: "完成",
            usage: { promptTokens: 5000, completionTokens: 100 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 5000 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_ok_budget", budgetTokens: 600_000 })
    );
    const text = await res.text();
    expect(text).not.toContain("budget_exhausted");
    expect(text).toContain('"termination":"natural"');
  });

  it("并发准入：running 任务数达上限时新任务 429,重连不受限", async () => {
    process.env.LLM_MAX_CONCURRENT_TASKS = "1";
    let finishStream: () => void;
    vi.mocked(streamText).mockImplementation(() => ({
      toDataStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            // 模拟在途流:写一个 chunk 后挂起不关闭,直到测试显式放行
            controller.enqueue(new TextEncoder().encode('0:"working"\n'));
            void new Promise<void>((resolve) => {
              finishStream = resolve;
            }).then(() => controller.close());
          },
        }),
    }) as never);

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });

    // 任务 A:占满并发名额(流挂起在途)
    const resA = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_conc_a" })
    );
    expect(resA.status).toBe(200);
    expect(await POST.isSessionRunning("sess_conc_a")).toBe(true);

    // 新任务 B:被准入拒绝
    const resB = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_conc_b" })
    );
    expect(resB.status).toBe(429);
    expect(((await resB.json()) as { error?: string }).error).toContain("并发已达上限");

    // 重连是接入既有任务:不受名额限制
    const resRecon = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_conc_a", reconnect: true })
    );
    expect(resRecon.status).toBe(200);

    // 放行 A 结束后,B 可正常发起
    finishStream!();
    await new Promise((r) => setTimeout(r, 20));
    const resB2 = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_conc_b" })
    );
    expect(resB2.status).toBe(200);
  });
});

describe("Plan→execute 结构化交接（WS-4）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  // 合规 plan 代码块(与 prompt few-shot 同构,含 methods 机器参数)
  const PLAN_BLOCK_TEXT = [
    "请确认以下分析方案。",
    "```openui",
    "root = Root([plan])",
    'plan = PlanReviewCard("CAC 思路确认（方法：pareto）", "各渠道 CAC 对比", ["postgres: m.leads"], [{"title":"采样","chart":"DataTable"}], [{"question":"口径？","options":["仅投放"],"default":"仅投放"}], "按此思路开始分析", ["pareto"])',
    "```",
  ].join("\n");

  function makeSessionsStub(context?: Partial<SessionContextMeta>) {
    return {
      getContext: vi.fn(async () => context),
      updateContext: vi.fn<(sessionId: string, patch: SessionContextMeta) => Promise<void>>(
        async () => {}
      ),
    } satisfies SessionContextStore & {
      getContext: unknown;
      updateContext: unknown;
    };
  }

  function mockPlanTextStream(finalText: string) {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: finalText,
            usage: { promptTokens: 100, completionTokens: 50 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 100 } } as never);
        },
      }) as never
    );
  }

  it("plan 模式 onFinish:触发 onTaskFinish 应用收尾钩子（finalText/sessions 透传）", async () => {
    mockPlanTextStream(PLAN_BLOCK_TEXT);
    const sessions = makeSessionsStub();
    const onTaskFinish = vi.fn().mockResolvedValue(undefined);
    const POST = createAnalyzeHandler({ sessions, onTaskFinish });

    await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_plan", mode: "plan" })
    );

    expect(onTaskFinish).toHaveBeenCalledTimes(1);
    const event = onTaskFinish.mock.calls[0][0];
    expect(event.mode).toBe("plan");
    expect(event.sessionId).toBe("sess_plan");
    expect(event.finalText).toContain("pareto");
    expect(event.sessions).toBe(sessions);
  });

});

describe("finish_task 服务端不变量（WS-5）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  function makeTelemetrySpy() {
    const events: Array<{ type: string; code?: string }> = [];
    return { events, sink: { emit: (e: never) => events.push(e) } };
  }

  it("无产出证据宣告 completed:被服务端拒绝并返回纠正指令(terminated=false)", async () => {
    const { events, sink } = makeTelemetrySpy();
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) , telemetry: sink });
    await POST(makeRequest({ messages: [], apiKey: "k" }));

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<{ terminated: boolean; status: string; message: string }>;
    };
    const result = await finishTool.execute({ status: "completed", summary: "完成" });

    expect(result.terminated).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.message).toContain("insufficient_data");
    expect(events.some((e) => e.type === "warn" && e.code === "FINV_GATE_REJECTED")).toBe(true);
  });

  it("已输出看板代码块后宣告 completed:正常闭环(terminated=true)", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: '分析报告……\n```openui\nroot = Root([insight])\ninsight = InsightBox("tip","结论","内容")\n```',
            usage: { promptTokens: 100, completionTokens: 50 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 100 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    await POST(makeRequest({ messages: [], apiKey: "k" }));

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<{ terminated: boolean; status: string }>;
    };
    const result = await finishTool.execute({ status: "completed", summary: "完成" });
    expect(result.terminated).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("模型已输出实质性文本时宣告 completed:允许正常闭环(terminated=true)", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: "谢谢！本次分析已完成闭环，祝你工作顺利！",
            usage: { promptTokens: 50, completionTokens: 20 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 50 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    await POST(makeRequest({ messages: [{ role: "user", content: "不错" }], apiKey: "k" }));

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<{ terminated: boolean; status: string; message: string }>;
    };
    const result = await finishTool.execute({ status: "completed", summary: "感谢反馈" });
    expect(result.terminated).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.message).toContain("任务已确认闭环");
  });

  it("问答查询已产生文本说明时宣告 completed:允许正常闭环(terminated=true)", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: "GitLab MCP 共有 38 个工具，覆盖 MR、Issue 与项目管理。",
            usage: { promptTokens: 80, completionTokens: 30 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 80 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    await POST(makeRequest({ messages: [{ role: "user", content: "gitlab mcp 有哪些工具" }], apiKey: "k" }));

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<{ terminated: boolean; status: string; message: string }>;
    };
    const result = await finishTool.execute({ status: "completed", summary: "列举工具清单" });
    expect(result.terminated).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("纯文本摘要交付时宣告 completed:允许正常闭环(terminated=true)", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: "核心结论摘要：1. 10月GMV达1890万；2. 退款率集中在湖北与北京。",
            usage: { promptTokens: 120, completionTokens: 40 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 120 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "请按已确认思路执行。澄清问题答复：「输出形式？」选择：仅核心结论摘要。" }],
        apiKey: "k",
        mode: "execute",
      })
    );

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<{ terminated: boolean; status: string; message: string }>;
    };
    const result = await finishTool.execute({ status: "completed", summary: "核心结论已提炼" });
    expect(result.terminated).toBe(true);
    expect(result.status).toBe("completed");
  });
});

describe("多应用生态：Prompt 与工具隔离", () => {
  it("当 appId 为通用助手 general 时，采用 resolveAppPrompt 提示词且不装配数据库工具", async () => {
    vi.mocked(streamText).mockImplementation(() => streamResult({}) as never);
    const resolveAppPrompt = vi.fn().mockImplementation((appId) => {
      if (appId === "general") return "你是一位通用智能助手，专注于编程与写作。";
      return undefined;
    });

    const POST = createAnalyzeHandler({
      resolveAppPrompt,
    });

    await POST(
      makeRequest({
        appId: "general",
        messages: [{ role: "user", content: "帮我重构这段代码" }],
        apiKey: "test-key",
      })
    );

    expect(resolveAppPrompt).toHaveBeenCalledWith("general", expect.any(Object));
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(arg.system).toContain("你是一位通用智能助手，专注于编程与写作。");
    // 不应含有默认数据分析的 SQL / 表结构要求
    expect(arg.system).not.toContain("## 认证口径（Certified Queries）");
    // 数据库工具不被装配
    expect(arg.tools?.execute_sql).toBeUndefined();
    expect(arg.tools?.query_rows).toBeUndefined();
  });
});


describe("Provider 韧性层 fallback 链（WS-9）", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "OPENAI_API_KEY",
    "LLM_API_KEY",
    "OPENAI_BASE_URL",
    "LLM_BASE_URL",
    "OPENAI_MODEL",
    "LLM_MODEL",
    "LLM_MAX_RETRIES",
    "LLM_REQUEST_TIMEOUT_MS",
    "LLM_FALLBACK_MODELS",
  ];
  let events: Array<Record<string, unknown>>;
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    events = [];
    mockStreamOk();
    POST = createAnalyzeHandler({
      telemetry: { emit: (e) => events.push(e as Record<string, unknown>) },
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.clearAllMocks();
  });

  const hasWarn = (code: string) =>
    events.some((e) => e.type === "warn" && e.code === code);

  it("主模型 503 用尽重试后 fallback 成功:客户端流含 model_fallback 分块并发遥测", async () => {
    const serverErr = Object.assign(new Error("503 Service Unavailable"), {
      statusCode: 503,
    });
    // 失败形态:读取流时异步抛错(贴近真实 SDK 的 reject 时机,merge() 不再替我们吞错)
    vi.mocked(streamText)
      .mockImplementationOnce(() => streamResult({ error: serverErr }) as never)
      .mockImplementationOnce(
        () => streamResult({ chunks: ['0:"ok"\n'] }) as never
      );

    const res = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: { fallbacks: [{ model: "backup-model" }] },
      })
    );
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(text).toContain('0:"ok"');
    expect(text).toContain('"type":"model_fallback"');
    expect(text).toContain('"from":"gpt-4o-mini"');
    expect(text).toContain('"to":"backup-model"');
    expect(text).toContain('"reason":"server"');
    expect(hasWarn("MODEL_FALLBACK")).toBe(true);
    // fallback 模型经 createOpenAI 装配(第二次 provider 调用以 backup-model 建模型)
    const { createOpenAI } = await import("@ai-sdk/openai");
    const secondProvider = vi.mocked(createOpenAI).mock.results[1]
      .value as ReturnType<typeof vi.fn>;
    expect(secondProvider).toHaveBeenCalledWith("backup-model");
  });

  it("fallback 也失败:按 onError 报错,不无限切换", async () => {
    const firstErr = Object.assign(new Error("503 Service Unavailable"), {
      statusCode: 503,
    });
    const secondErr = Object.assign(new Error("backup also down"), {
      statusCode: 503,
    });
    vi.mocked(streamText)
      .mockImplementationOnce(() => streamResult({ error: firstErr }) as never)
      .mockImplementationOnce(() => streamResult({ error: secondErr }) as never);

    const res = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: { fallbacks: [{ model: "backup-model" }] },
      })
    );
    const text = await res.text();

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    // 只切换一次:不越过链尾（包含 writeData 与 writeMessageAnnotation 各一次）
    expect(text.match(/"type":"model_fallback"/g) ?? []).toHaveLength(2);
    // 错误按 onError 路径写给客户端
    expect(text).toContain("backup also down");
    expect(hasWarn("MODEL_FALLBACK")).toBe(true);
  });

  it("首分块后失败:不重跑、发 MID_STREAM_FAILURE 遥测、按 onError 报错", async () => {
    const netErr = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    vi.mocked(streamText).mockImplementation(
      (opts) =>
        streamResult({
          error: netErr,
          onStart: () => {
            (
              opts.onChunk as ((e: unknown) => void) | undefined
            )?.({ chunk: { type: "text-delta", textDelta: "部分结果" } });
          },
        }) as never
    );

    const res = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: { fallbacks: [{ model: "backup-model" }] },
      })
    );
    const text = await res.text();

    // 客户端已见部分内容:不做透明重跑/不切换模型
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(text).not.toContain("model_fallback");
    expect(hasWarn("MID_STREAM_FAILURE")).toBe(true);
    expect(text).toContain("socket hang up");
  });

  it("context_overflow 可 fallback 到更大窗模型;auth 错误不 fallback", async () => {
    const overflowErr = Object.assign(
      new Error(
        "This model's maximum context length is 4096 tokens. Please reduce the length."
      ),
      { statusCode: 400 }
    );
    const authErr = Object.assign(new Error("invalid api key"), {
      statusCode: 401,
    });
    // context_overflow:不重试但允许切换
    vi.mocked(streamText)
      .mockImplementationOnce(() => streamResult({ error: overflowErr }) as never)
      .mockImplementationOnce(
        () => streamResult({ chunks: ['0:"ok"\n'] }) as never
      );
    const res1 = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: { fallbacks: [{ model: "big-window-model" }] },
      })
    );
    const text1 = await res1.text();
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(text1).toContain('"to":"big-window-model"');
    expect(text1).toContain('"reason":"context_overflow"');

    // auth:凭证问题重试/切换均无意义,单次调用直接报错
    vi.mocked(streamText).mockImplementation(
      () => streamResult({ error: authErr }) as never
    );
    const res2 = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: { fallbacks: [{ model: "backup-model" }] },
      })
    );
    const text2 = await res2.text();
    expect(vi.mocked(streamText).mock.calls.length).toBe(3);
    expect(text2).toContain("invalid api key");
    expect(text2).not.toContain("model_fallback");
  });

  it("凭证护栏:fallback 指向新 baseURL 但无对应 key 时 400;自带 key 放行", async () => {
    const res = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: {
          fallbacks: [{ model: "m", baseURL: "http://other.example/v1" }],
        },
      })
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(streamText)).not.toHaveBeenCalled();
    expect(hasWarn("CRED_GUARD_REJECTED")).toBe(true);

    // 自带 key 的 fallback 正常放行
    const okRes = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: {
          fallbacks: [
            { model: "m", baseURL: "http://other.example/v1", apiKey: "k2" },
          ],
        },
      })
    );
    expect(okRes.status).toBe(200);
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
  });

  it("环境变量 LLM_FALLBACK_MODELS 提供 fallback 链(请求体未配置时)", async () => {
    process.env.LLM_FALLBACK_MODELS = JSON.stringify([
      { model: "env-backup-model" },
    ]);
    const serverErr = Object.assign(new Error("503"), { statusCode: 503 });
    vi.mocked(streamText)
      .mockImplementationOnce(() => streamResult({ error: serverErr }) as never)
      .mockImplementationOnce(
        () => streamResult({ chunks: ['0:"ok"\n'] }) as never
      );

    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    const text = await res.text();

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(text).toContain('"to":"env-backup-model"');
    const { createOpenAI } = await import("@ai-sdk/openai");
    const secondProvider = vi.mocked(createOpenAI).mock.results[1]
      .value as ReturnType<typeof vi.fn>;
    expect(secondProvider).toHaveBeenCalledWith("env-backup-model");
  });

  it("缺省(无 resilience 配置)失败即报错:单次调用,不 fallback", async () => {
    const serverErr = Object.assign(new Error("503 Service Unavailable"), {
      statusCode: 503,
    });
    vi.mocked(streamText).mockImplementationOnce(
      () => streamResult({ error: serverErr }) as never
    );

    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    const text = await res.text();

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(text).toContain("503 Service Unavailable");
    expect(hasWarn("MODEL_FALLBACK")).toBe(false);
  });

  it("tool-call 分块后失败:不重跑,防重复执行已发出的数据源工具调用", async () => {
    const netErr = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    vi.mocked(streamText).mockImplementation(
      (opts) =>
        streamResult({
          error: netErr,
          onStart: () => {
            // 工具调用已发出(客户端流中可见 tool-call 分块),首个 text-delta 前失败
            (
              opts.onChunk as ((e: unknown) => void) | undefined
            )?.({
              chunk: {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "jira_jira_search",
                args: { jql: "project = DEMO" },
              },
            });
          },
        }) as never
    );

    const res = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        resilience: { fallbacks: [{ model: "backup-model" }] },
      })
    );
    const text = await res.text();

    // tool-call 分块已写进客户端流:同样视为「已产出」,重发会重复执行工具(副作用)
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(text).not.toContain("model_fallback");
    expect(hasWarn("MID_STREAM_FAILURE")).toBe(true);
    expect(hasWarn("MODEL_FALLBACK")).toBe(false);
    expect(text).toContain("socket hang up");
  });

  it("用户停止(abort)触发的流错误:不 fallback、不 MID_STREAM_FAILURE,按既有 onError 收尾", async () => {
    const abortErr = new Error("The operation was aborted");
    vi.mocked(streamText).mockImplementation(
      (opts) =>
        ({
          toDataStream: () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                const signal = opts.abortSignal as AbortSignal | undefined;
                const fail = () => controller.error(abortErr);
                if (signal?.aborted) {
                  fail();
                  return;
                }
                signal?.addEventListener("abort", fail, { once: true });
                controller.enqueue(new TextEncoder().encode('0:"working"\n'));
              },
            }),
        }) as never
    );

    const res = await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        sessionId: "sess_ws9_abort",
        resilience: { fallbacks: [{ model: "backup-model" }] },
      })
    );
    expect(res.status).toBe(200);

    // 用户显式停止 → taskAbortController 触发 → 流读取错误必须走 abort 白名单
    const stopRes = await POST(
      makeRequest({ action: "stop", sessionId: "sess_ws9_abort" } as never)
    );
    expect(((await stopRes.json()) as { stopped?: boolean }).stopped).toBe(true);

    // 白名单:不 fallback、不 MID_STREAM_FAILURE
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(hasWarn("MID_STREAM_FAILURE")).toBe(false);
    expect(hasWarn("MODEL_FALLBACK")).toBe(false);

    // 既有 error 语义:hub 以 error 终止订阅(res.text() 按现状拒绝,WS-2 设计),
    // 原始 abort 错误经 onError 转 STREAM_ERROR 遥测
    await new Promise((r) => setTimeout(r, 20));
    expect(
      events.some((e) => e.type === "error" && e.code === "STREAM_ERROR")
    ).toBe(true);
    await expect(res.text()).rejects.toThrow("Stream error");
  });
});

describe("WS-11 成本入账", () => {
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("成功流在 onFinish 入账一条 UsageRecord，口径与 task_finish 遥测一致（SDK 累计值）", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onFinish?.({ usage: { promptTokens: 5000, completionTokens: 100 } } as never);
        },
      }) as never
    );

    const ledger = new InMemoryCostLedger();
    const pricing = { priceFor: () => ({ input: 2.5, output: 10 }) } as unknown as ModelPricingTable;
    const POST = createAnalyzeHandler({
      costLedger: ledger,
      quota: { tenantTokenLimit: 1_000_000, windowMs: 3_600_000 },
      pricing,
    });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    await res.text();
    // record 是 fire-and-forget：等微任务落定
    await new Promise((r) => setTimeout(r, 10));

    const usage = await ledger.sumUsage("anon", 86_400_000);
    expect(usage.tokens).toBe(5100);
    expect(usage.costUsd).toBeCloseTo((5000 / 1e6) * 2.5 + (100 / 1e6) * 10, 6);
  });

  it("未注入台账且未配置配额时不入账、不拦截（零行为变化）", async () => {
    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(POST.costLedger).toBeUndefined();
  });

  it("流输出中同时下发 finops_cost 的 dataStream 与 messageAnnotation", async () => {
    vi.mocked(streamText).mockImplementation((opts) =>
      streamResult({
        onStart: () => {
          opts.onFinish?.({ usage: { promptTokens: 1200, completionTokens: 300 } } as never);
        },
      }) as never
    );

    const POST = createAnalyzeHandler({ resolveAppTools: async () => ({}) });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"finops_cost"');
    expect(text).toContain('"promptTokens":1200');
    expect(text).toContain('"completionTokens":300');
    expect(text).toContain('"totalTokens":1500');
  });

  describe("MCP 工具动态注入到 Analyze 对话管道", () => {
    it("启用 MCP 服务时，动态装配 MCP tools 挂载至 streamText 并注入提示词", async () => {
      const mockMcpManager = {
        registerServers: vi.fn(),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "search_repositories",
            description: "Search repos",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
          },
        ]),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify([{ id: 1, name: "openui" }]) }],
        }),
      } as unknown as MCPClientManager;

      const POST = createAnalyzeHandler({
        mcp: {
          manager: mockMcpManager,
          getServers: () => [
            {
              id: "gitlab",
              name: "GitLab 协同",
              transport: "sse",
              enabled: true,
            },
          ],
        },
      });

      await POST(makeRequest({ messages: [{ role: "user", content: "查仓库" }], apiKey: "k" }));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.tools).toHaveProperty("gitlab_search_repositories");
    });

    it("当 MCP 服务连接失败时，优雅降级记录告警且不中断正常请求", async () => {
      const events: Array<{ type: string; code?: string }> = [];
      const sink = { emit: (e: never) => events.push(e) };
      const mockMcpManager = {
        registerServers: vi.fn(),
        listTools: vi.fn().mockRejectedValue(new Error("Connection refused")),
      } as unknown as MCPClientManager;

      const POST = createAnalyzeHandler({
        telemetry: sink,
        mcp: {
          manager: mockMcpManager,
          getServers: () => [
            {
              id: "broken_mcp",
              name: "Broken MCP",
              transport: "sse",
              enabled: true,
            },
          ],
        },
      });

      const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
      expect(res.status).toBe(200);
      expect(events.some((e) => e.type === "warn" && e.code === "MCP_SERVER_LOAD_FAILED")).toBe(true);
    });
  });
});
