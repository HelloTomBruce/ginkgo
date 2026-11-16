// @vitest-environment node
/**
 * WS-6 Tier A:离线轨迹回归(零 LLM 成本,进 CI 门禁)。
 *
 * 用脚本化的「模型行为剧本」驱动 handler 全链路,断言 harness 的机制语义:
 * 工具调用序列、终态类型、单步 token 锚点、上下文投影、注入信封与不变量门。
 * 断线重连轨迹由 handler.test.ts「流重连」用例锁定,此处不重复。
 *
 * 真实模型的行为质量评估见同目录 tier-b.real-model.test.ts(手动/夜间,需真实 Key)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAnalyzeHandler,
  type SessionContextStore,
} from "../handler";
import type { DatasourceManager, McpToolBinding } from "@openui-analytics/datasources";
import type { HarnessEvent, TelemetrySink } from "../telemetry";
import { streamText, generateText } from "ai";

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

function spyTelemetry(): { events: HarnessEvent[]; sink: TelemetrySink } {
  const events: HarnessEvent[] = [];
  return { events, sink: { emit: (e) => events.push(e) } };
}

/** 最小 DatasourceManager stub:单源单工具,call 返回脚本化结果(不触碰真实连接) */
function stubManager(toolResult: unknown): DatasourceManager {
  return {
    resolveActive: () => [{ id: "src1", name: "测试源", enabled: true }],
    get: (id: string) => ({ id, name: "测试源", kind: "http-mcp", enabled: true }),
    tools: async (): Promise<McpToolBinding[]> => [
      {
        name: "src1_query",
        originalName: "query",
        description: "查询",
        inputSchema: { type: "object" },
        call: async () => toolResult,
      },
    ],
    getSchemaCard: async () => undefined,
  } as unknown as DatasourceManager;
}

interface StepScript {
  text?: string;
  toolCalls?: string[];
  finishReason: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

interface TrajectoryResult {
  text: string;
  args: Record<string, unknown>;
  events: HarnessEvent[];
}

/**
 * 轨迹驱动器:按剧本依次回调 onStepFinish(可触发真实工具 execute)、
 * 可选显式 finish_task、最后 onFinish——单次 streamText mock 覆盖全轨迹。
 */
async function runTrajectory(opts: {
  body?: Record<string, unknown>;
  manager?: DatasourceManager;
  sessions?: SessionContextStore;
  steps: StepScript[];
  invokeTools?: boolean;
  finishUsage?: { promptTokens?: number; completionTokens?: number };
  callFinishTask?: { status: "completed" | "insufficient_data" | "blocked"; summary?: string };
}): Promise<TrajectoryResult> {
  const { events, sink } = spyTelemetry();
  let captured: Record<string, unknown> = {};

  vi.mocked(streamText).mockImplementationOnce((handlerOpts: unknown) => {
    const o = handlerOpts as {
      tools?: Record<string, { execute?: (a: unknown, c: unknown) => Promise<unknown> }>;
      onStepFinish?: (s: unknown) => void;
      onFinish?: (u: unknown) => void;
    };
    captured = o as Record<string, unknown>;
    return {
      // 必须同步:handler 不 await mergeIntoDataStream,execute 返回后
      // createDataStreamResponse 即关流——异步写入会全部丢失。
      // 工具 execute 与 finish_task 的副作用均在首个 await 前完成,void 调用即可
      mergeIntoDataStream: vi.fn(() => {
        for (const step of opts.steps) {
          if (opts.invokeTools) {
            for (const name of step.toolCalls ?? []) {
              const t = o.tools?.[name];
              if (t?.execute) void t.execute({}, {});
            }
          }
          o.onStepFinish?.({
            stepType: step.toolCalls?.length ? "tool-result" : "text",
            toolCalls: (step.toolCalls ?? []).map((n) => ({ toolName: n })),
            finishReason: step.finishReason,
            text: step.text ?? "",
            usage: step.usage,
          });
        }
        if (opts.callFinishTask) {
          void o.tools?.finish_task?.execute?.(opts.callFinishTask, {});
        }
        o.onFinish?.({ usage: opts.finishUsage });
      }),
    } as never;
  });

  const manager = opts.manager ?? stubManager({ rows: [{ a: 1 }] });
  const POST = createAnalyzeHandler({
    datasources: manager,
    sessions: opts.sessions,
    telemetry: sink,
  });
  const res = await POST(
    makeRequest({ messages: [], apiKey: "k", sessionId: "sess_eval", ...opts.body })
  );
  const text = await res.text();
  return { text, args: captured, events };
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "LLM_API_KEY",
  "OPENAI_MODEL",
  "LLM_MODEL",
  "OPENAI_BASE_URL",
  "LLM_BASE_URL",
  "LLM_MAX_STEPS",
  "LLM_TASK_TOKEN_BUDGET",
  "LLM_MAX_CONCURRENT_TASKS",
  "LLM_TASK_TIMEOUT_MS",
];

describe("Tier A 轨迹回归（零 LLM 成本）", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.OPENAI_API_KEY = "eval-key";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("T1 快乐轨迹:工具循环→看板→显式闭环;事件序列与单步锚点符合契约", async () => {
    const dashboard = '看板如下\n```openui\nroot = Root([insight])\ninsight = InsightBox("tip","结论","内容")\n```';
    const { text, args, events } = await runTrajectory({
      steps: [
        { toolCalls: ["src1_query"], finishReason: "tool-calls", usage: { promptTokens: 1000, completionTokens: 100 } },
        { text: dashboard, finishReason: "stop", usage: { promptTokens: 1200, completionTokens: 300 } },
      ],
      invokeTools: true,
      finishUsage: { promptTokens: 2200, completionTokens: 400 },
      callFinishTask: { status: "completed", summary: "分析完成" },
    });

    // 事件序列:run_start → step_finish×2 → tool_result(ok) → task_finish(explicit/completed)
    const kinds = events.map((e) => e.type);
    expect(kinds[0]).toBe("run_start");
    expect(events.filter((e) => e.type === "step_finish")).toHaveLength(2);
    const toolEvent = events.find((e) => e.type === "tool_result") as
      | Extract<HarnessEvent, { type: "tool_result" }>
      | undefined;
    expect(toolEvent).toMatchObject({ tool: "src1_query", ok: true });
    const finishEvent = events.find((e) => e.type === "task_finish") as
      | Extract<HarnessEvent, { type: "task_finish" }>
      | undefined;
    expect(finishEvent).toMatchObject({
      termination: "explicit",
      status: "completed",
      totalPromptTokens: 2200,
      totalCompletionTokens: 400,
    });

    // Data Stream:单步锚点=最后一步实测值;task_finish 恰一次(explicit)
    expect(text).toContain('"promptTokens":1200');
    expect(text.split('"termination":"explicit"')).toHaveLength(2); // 1 次出现
    expect(text).not.toContain('"termination":"natural"');

    // finish_task 正常闭环(有看板证据,不变量门放行)
    expect(String(args.system)).toContain("Untrusted Data Handling");
  });

  it("T2 预算熔断轨迹:超限即 budget_exhausted 恰一次 + provider 中止", async () => {
    const { text, args, events } = await runTrajectory({
      body: { budgetTokens: 10_000 },
      steps: [
        { toolCalls: ["src1_query"], finishReason: "tool-calls", usage: { promptTokens: 400_000, completionTokens: 200_000 } },
        { text: "后续步骤(真实场景中不会发生)", finishReason: "stop", usage: { promptTokens: 400_000, completionTokens: 200_000 } },
      ],
      invokeTools: true,
      finishUsage: { promptTokens: 800_000, completionTokens: 400_000 },
    });

    expect(text.split('"termination":"budget_exhausted"')).toHaveLength(2); // 恰 1 次
    expect(text).not.toContain('"termination":"natural"');
    const combined = (args as { abortSignal?: AbortSignal }).abortSignal;
    expect(combined?.aborted).toBe(true);
    expect(events.some((e) => e.type === "warn" && (e as { code?: string }).code === "BUDGET_EXHAUSTED")).toBe(true);
  });

  it("T3a 投影轨迹:超阈值触发 tool 结果剪枝,保留窗口逐字保留", async () => {
    // 60 条 2KB tool 结果 ≈ 30k tokens,窗口 hint 32k → triggerAt=22.4k,保留窗 8k
    const toolMsg = (i: number) => ({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "src1_query",
          result: `历史查询结果#${i}:` + "x".repeat(2048),
        },
      ],
    });
    const messages = [
      { role: "user", content: "分析一下" },
      ...Array.from({ length: 60 }, (_, i) => toolMsg(i)),
    ];
    const { args, events } = await runTrajectory({
      body: { messages, contextWindow: 32_000, maxTokens: 1024 },
      steps: [{ finishReason: "stop", usage: { promptTokens: 1000 } }],
    });

    const projection = events.find((e) => e.type === "context_projection") as
      | Extract<HarnessEvent, { type: "context_projection" }>
      | undefined;
    expect(projection).toBeDefined();
    expect(projection!.pruned).toBeGreaterThan(0);

    // 发往模型的投影:旧 tool 结果被占位符替换,保留窗口原样
    const sent = (args as { messages?: Array<{ content: unknown }> }).messages ?? [];
    const sentText = JSON.stringify(sent);
    expect(sentText).toContain("已裁剪");
    expect(sentText.length).toBeLessThan(JSON.stringify(messages).length);
  });

  it("T3b 投影轨迹:纯文本长历史触发摘要,system 注入摘要且摘要被缓存", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "SUMMARY_SENTINEL_此前已完成渠道 CAC 基础分析",
    } as never);
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `第${i}轮讨论:` + "y".repeat(4096),
    }));
    const { args, events } = await runTrajectory({
      body: { messages, contextWindow: 32_000, maxTokens: 1024 },
      steps: [{ finishReason: "stop", usage: { promptTokens: 1000 } }],
    });

    const projection = events.find((e) => e.type === "context_projection") as
      | Extract<HarnessEvent, { type: "context_projection" }>
      | undefined;
    expect(projection?.summarized).toBe(true);

    const system = String((args as { system?: string }).system);
    expect(system).toContain("此前会话摘要");
    expect(system).toContain("SUMMARY_SENTINEL");
    // 发送消息数 < 输入数(摘要覆盖段已移除)
    const sent = (args as { messages?: unknown[] }).messages ?? [];
    expect(sent.length).toBeLessThan(messages.length);
  });

  it("T4 注入防御轨迹:超长工具结果进信封,无产出宣告 completed 被门禁拒绝", async () => {
    const hugeResult = "A".repeat(100_000); // 100KB 工具结果 → 32KB 信封
    const { args, events } = await runTrajectory({
      manager: stubManager(hugeResult),
      steps: [
        { toolCalls: ["src1_query"], finishReason: "tool-calls", usage: { promptTokens: 1000 } },
      ],
      invokeTools: true,
      callFinishTask: { status: "completed", summary: "完成" },
      finishUsage: { promptTokens: 1000 },
    });

    // 不变量门:无看板/规划卡宣告 completed 被拒
    expect(
      events.some((e) => e.type === "warn" && (e as { code?: string }).code === "FINV_GATE_REJECTED")
    ).toBe(true);

    // 信封:同一 handler 工具链返回 untrusted 标注的截断文本(头尾保留)
    const tools = (args as { tools?: Record<string, { execute?: (a: unknown, c: unknown) => Promise<unknown> }> }).tools;
    const out = (await tools?.src1_query?.execute?.({}, {})) as {
      output?: string;
      truncated?: boolean;
    };
    expect(out.truncated).toBe(true);
    expect(out.output).toBeDefined();
    expect(out.output!).toContain('<tool_output source="src1"');
    expect(out.output!).toContain('untrusted="true"');
    expect(out.output!.length).toBeLessThan(60_000);
  });
});
