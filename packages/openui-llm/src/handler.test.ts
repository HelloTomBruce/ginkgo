// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnalyzeHandler, type SessionContextMeta, type SessionContextStore } from "./handler";
import type {
  DatasourceManager,
  McpToolBinding,
} from "@openui-analytics/datasources";
import { streamText, generateText } from "ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DYNAMIC_HTTP = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "",
  enabled: true,
};

// 依赖注入接缝：真 manager 读临时配置文件（resolveActive/get 走真实现），
// 仅 tools（IO）覆写为 mock —— 等价于原 vi.mock("@/lib/datasources") 的语义
async function makeFakeManager(
  extraSources: Record<string, unknown>[] = []
): Promise<DatasourceManager> {
  const { createDatasourceManager } = await import(
    "@openui-analytics/datasources"
  );
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "llm-handler-")),
    "datasources.json"
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      sources: [
        {
          id: "jira",
          name: "Jira MCP",
          kind: "http-mcp",
          url: "http://10.0.0.1:6000/mcp",
          token: "",
          enabled: true,
        },
        ...extraSources,
      ],
    })
  );
  const real = createDatasourceManager({ configPath: file });
  const tools = vi.fn(async (): Promise<McpToolBinding[]> => []);
  return { ...real, tools };
}

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

function mockStreamOk() {
  vi.mocked(streamText).mockReturnValue({
    toDataStreamResponse: () =>
      new Response('0:"ok"\n', {
        headers: { "x-vercel-ai-data-stream": "v1" },
      }),
    mergeIntoDataStream: (dataStream: { write: (chunk: string) => void }) => {
      dataStream.write('0:"ok"\n');
    },
  } as unknown as ReturnType<typeof streamText>);
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
    POST = createAnalyzeHandler({ datasources: await makeFakeManager() });
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
    expect(text).toContain("未检测到 LLM API Key");
    expect(text).toContain("「设置」");
  });

  it("动态源工具加载失败时降级为空工具集并正常流式响应", async () => {
    const manager = await makeFakeManager();
    vi.mocked(manager.tools).mockRejectedValueOnce(
      new Error("connection refused")
    );
    POST = createAnalyzeHandler({ datasources: manager });

    const res = await POST(makeRequest({ messages: [], apiKey: "test-key" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith("3:")).toBe(false);
    expect(streamText).toHaveBeenCalledTimes(1);
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

  it("sources 未知 id 忽略并告警，请求仍 200 且不装载任何源", async () => {
    const manager = await makeFakeManager();
    POST = createAnalyzeHandler({ datasources: manager });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["nope"] })
    );

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nope"));
    expect(manager.tools).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("createAnalyzeHandler 全动态装配", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("未指定 sources 时装载全部启用源，gitlab 透传字段被忽略", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        gitlabUrl: "http://legacy.example/mcp",
        gitlabToken: "glpat-old",
      })
    );

    expect(manager.tools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    // 仅 jira 单源（无禅道×GitLab 对）：跨源映射工具不注册
    expect(Object.keys(arg.tools ?? {})).not.toContain("cross_source_link");
  });

  it("跨源 pair 配置且双侧源激活时注册 cross_source_link 工具", async () => {
    // pair 配置由用户维护（config/cross-source-map.json），测试用临时文件注入
    const pairFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "handler-pair-")),
      "map.json"
    );
    fs.writeFileSync(
      pairFile,
      JSON.stringify({
        mappings: [
          {
            projectSource: "zentao-cli",
            project: "42",
            repoSource: "gitlab",
            repo: "backend/trading-platform",
          },
        ],
      })
    );
    const { reloadCrossSourceMap } = await import("./crossSourceMap");
    reloadCrossSourceMap(pairFile);
    try {
      const manager = await makeFakeManager([
        {
          id: "zentao-cli",
          name: "禅道",
          kind: "stdio-cli",
          command: "zentao",
          enabled: true,
        },
        {
          id: "gitlab",
          name: "gitlab",
          kind: "http-mcp",
          url: "http://10.0.0.1:6001/mcp",
          token: "",
          enabled: true,
        },
      ]);
      const POST = createAnalyzeHandler({ datasources: manager });

      await POST(makeRequest({ messages: [], apiKey: "k" }));

      const arg = vi.mocked(streamText).mock.calls[0][0];
      expect(Object.keys(arg.tools ?? {})).toContain("cross_source_link");
      expect(arg.system).toContain("Cross-Source Joint Analysis");
    } finally {
      reloadCrossSourceMap("/nonexistent/cross-source-map.json");
    }
  });

  it("protocol=anthropic 时走 createAnthropic 且 baseURL 规范化补 /v1，不调 createOpenAI", async () => {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

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
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

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

  it("sources 指定动态源时装载其工具并入 tools，prompt 列出该源", async () => {
    const manager = await makeFakeManager();
    vi.mocked(manager.tools).mockResolvedValueOnce([
      {
        name: "jira_jira_search",
        originalName: "jira_search",
        description: "d",
        inputSchema: { type: "object" },
        call: async () => ({}),
      },
    ]);
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(makeRequest({ messages: [], apiKey: "k", sources: ["jira"] }));

    expect(manager.tools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(Object.keys(arg.tools ?? {})).toContain("jira_jira_search");
    expect(arg.system).toContain("Jira MCP");
    // 无内置静态段
    expect(arg.system).not.toContain("PostgreSQL Analytics Database");
  });

  it("mode 分派：plan → 规划提示词；execute → 执行提示词；非法/缺省 → direct，默认 maxSteps=25", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(makeRequest({ messages: [], apiKey: "k", mode: "plan" }));
    let arg = vi.mocked(streamText).mock.calls[0][0];
    expect(arg.system).toContain("Planning Mode");
    expect(arg.system).toContain("PlanReviewCard");
    expect(arg.maxSteps).toBe(25);
    // 规划轮次工具照常装配（探查需要）；跨源映射工具因无禅道×GitLab 对而不注册
    expect(Object.keys(arg.tools ?? {})).not.toContain("cross_source_link");

    await POST(makeRequest({ messages: [], apiKey: "k", mode: "execute" }));
    arg = vi.mocked(streamText).mock.calls[1][0];
    expect(arg.system).toContain("Confirmed Plan Execution Mode");
    expect(arg.maxSteps).toBe(25);

    // 非法值回落 direct：不含规划/执行增量段
    await POST(
      makeRequest({ messages: [], apiKey: "k", mode: "bogus" as unknown as "plan" })
    );
    arg = vi.mocked(streamText).mock.calls[2][0];
    expect(arg.system).not.toContain("Planning Mode");
    expect(arg.system).not.toContain("Confirmed Plan Execution Mode");

    // 缺省完全向后兼容
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    arg = vi.mocked(streamText).mock.calls[3][0];
    expect(arg.system).not.toContain("Planning Mode");
    expect(arg.maxSteps).toBe(25);
  });
});

describe("createAnalyzeHandler Schema Card 注入", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("启用源有卡时 system 含结构卡段；无卡时不含", async () => {
    const manager = await makeFakeManager();
    const card = {
      sourceId: "jira",
      generatedAt: 1761811200000,
      kind: "db-like" as const,
      truncated: false,
      tables: [
        {
          name: "issues",
          rowCount: 42,
          columns: [
            { name: "status", type: "text", cardinality: 3, topValues: ["open"] },
          ],
        },
      ],
    };
    const withCard = vi.fn(async () => ({ card, stale: false }));
    const POST1 = createAnalyzeHandler({
      datasources: { ...manager, getSchemaCard: withCard },
    });
    await POST1(makeRequest({ messages: [], apiKey: "k" }));
    const sys1 = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys1).toContain("Schema Cards");
    expect(sys1).toContain("issues（约 42 行）");

    // 无卡（null）→ 不注入
    const without = vi.fn(async () => null);
    const POST2 = createAnalyzeHandler({
      datasources: { ...manager, getSchemaCard: without },
    });
    await POST2(makeRequest({ messages: [], apiKey: "k" }));
    const sys2 = vi.mocked(streamText).mock.calls[1][0].system as string;
    expect(sys2).not.toContain("Schema Cards");
  });

  it("读卡失败静默降级（不阻塞分析请求）", async () => {
    const manager = await makeFakeManager();
    const broken = vi.fn(async () => {
      throw new Error("disk gone");
    });
    const POST = createAnalyzeHandler({
      datasources: { ...manager, getSchemaCard: broken },
    });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});

describe("createAnalyzeHandler 方法论注入", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("direct 模式注入方法索引（含内置卡条目）", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("Analysis Method Index");
    expect(sys).toContain("- trend: 趋势与同比环比");
  });

  it("execute 模式：从最近 assistant 消息（PlanReviewCard）提取方法 id 注入详情", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(
      makeRequest({
        messages: [
          { role: "user", content: "各渠道投放 ROI 怎么样" },
          {
            role: "assistant",
            content:
              '思路确认（方法：pareto + trend）\n```openui\nroot = Root([plan])\nplan = PlanReviewCard("投放 ROI 思路")\n```',
          },
          { role: "user", content: "按此思路开始分析" },
        ],
        apiKey: "k",
        mode: "execute",
      })
    );
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("### Method pareto");
    expect(sys).toContain("### Method trend");
    expect(sys).toContain("follow their detailed guidance strictly");
    // 按需详情：不注入全量索引
    expect(sys).not.toContain("Analysis Method Index");
  });

  it("execute 未命中方法：回落无详情的执行约束", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(
      makeRequest({
        messages: [
          { role: "assistant", content: "一个没有方法命名的规划" },
          { role: "user", content: "开始" },
        ],
        apiKey: "k",
        mode: "execute",
      })
    );
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("Confirmed Plan Execution Mode");
    expect(sys).not.toContain("### Method ");
  });

  it("methodology 注入自定义库：索引与 execute 详情来自注入卡", async () => {
    const { createMethodLibrary, builtinMethodCards } = await import(
      "@openui-analytics/methodology"
    );
    const custom = createMethodLibrary({
      builtin: builtinMethodCards,
      custom: [
        {
          id: "dora",
          name: "DORA 效能分析",
          when: "研发交付效能四指标",
          steps: ["计算部署频率/变更前置时间/变更失败率/恢复时间", "对标基准并定位短板"],
          chartPairing: ["AnalyticsChart", "MetricCard"],
          executeGuidance: "Compute the four DORA metrics and benchmark them; highlight the weakest dimension.",
        },
      ],
    });
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({
      datasources: manager,
      methodology: custom.library,
    });

    await POST(makeRequest({ messages: [], apiKey: "k" }));
    let sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    // 索引注入生效（11 卡超 1KB 预算截断——断言头部条目而非尾部 dora）
    expect(sys).toContain("Analysis Method Index");
    expect(sys).toContain("- trend: 趋势与同比环比");

    await POST(
      makeRequest({
        messages: [
          { role: "assistant", content: "规划（方法 dora）" },
          { role: "user", content: "开始" },
        ],
        apiKey: "k",
        mode: "execute",
      })
    );
    sys = vi.mocked(streamText).mock.calls[1][0].system as string;
    expect(sys).toContain("### Method dora · DORA 效能分析");
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
      datasources: await makeFakeManager(),
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
    // contextWindow=16384 + maxTokens=1024 → triggerAt=7168（夹具总量 ~7300+）
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
        contextWindow: 16384,
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
        contextWindow: 16384,
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
        contextWindow: 16384,
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
        contextWindow: 16384,
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
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(arg.tools).toBeDefined();
    expect(Object.keys(arg.tools ?? {})).toContain("finish_task");
  });

  it("显式调用 finish_task(insufficient_data,不受产出门禁限制)触发 explicit 终态并返回确认消息", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
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
    vi.mocked(streamText).mockImplementation((opts) => {
      return {
        mergeIntoDataStream: vi.fn(() => {
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "stop",
            text: "分析完成",
            usage: { promptTokens: 5000, completionTokens: 100 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 5000 } } as never);
        }),
      } as never;
    });

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    const text = await res.text();

    expect(text).toContain('"type":"task_finish"');
    expect(text).toContain('"termination":"natural"');
  });

  it("当因为达到上限截断时（finishReason=length），触发 step_limit_reached 终态", async () => {
    vi.mocked(streamText).mockImplementation((opts) => {
      return {
        mergeIntoDataStream: vi.fn(() => {
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "length",
            text: "被截断",
            usage: { promptTokens: 5000, completionTokens: 100 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 5000 } } as never);
        }),
      } as never;
    });

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    const text = await res.text();

    expect(text).toContain('"type":"task_finish"');
    expect(text).toContain('"termination":"step_limit_reached"');
    expect(text).toContain('"status":"truncated"');
  });

  it("步数预算：请求体 maxSteps 与环境变量 LLM_MAX_STEPS 优先级", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

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
      toDataStreamResponse: () =>
        new Response('0:"ok"\n', {
          headers: { "x-vercel-ai-data-stream": "v1" },
        }),
      mergeIntoDataStream: (dataStream: { merge: (stream: ReadableStream) => void }) => {
        dataStream.merge(
          new ReadableStream({
            start(controller) {
              controller.enqueue('0:"chunk1"\n');
              void new Promise<void>((resolve) => {
                finishStream = resolve;
              }).then(() => {
                controller.enqueue('0:"chunk2"\n');
                controller.close();
              });
            },
          })
        );
      },
    } as unknown as ReturnType<typeof streamText>);

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    // 第一次请求：启动后台流任务
    const res1 = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_recon_test" })
    );
    expect(res1.status).toBe(200);
    expect(POST.isSessionRunning("sess_recon_test")).toBe(true);
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
    expect(POST.isSessionRunning("sess_recon_test")).toBe(false);
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
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

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
    vi.mocked(streamText).mockImplementation((opts) => {
      return {
        mergeIntoDataStream: vi.fn(() => {
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
        }),
      } as never;
    });

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
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
    vi.mocked(streamText).mockImplementation((opts) => {
      return {
        mergeIntoDataStream: vi.fn(() => {
          opts.onStepFinish?.({
            stepType: "tool-result",
            toolCalls: [],
            finishReason: "stop",
            text: "完成",
            usage: { promptTokens: 5000, completionTokens: 100 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 5000 } } as never);
        }),
      } as never;
    });

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
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
    vi.mocked(streamText).mockImplementation(() => {
      return {
        mergeIntoDataStream: vi.fn((dataStream: {
          write: (chunk: string) => void;
        }) => {
          // 模拟在途流:写一个 chunk 后挂起,直到测试显式放行
          dataStream.write('0:"working"\n');
          void new Promise<void>((resolve) => {
            finishStream = resolve;
          });
        }),
      } as never;
    });

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    // 任务 A:占满并发名额(流挂起在途)
    const resA = await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_conc_a" })
    );
    expect(resA.status).toBe(200);
    expect(POST.isSessionRunning("sess_conc_a")).toBe(true);

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
    vi.mocked(streamText).mockImplementation((opts) => {
      return {
        mergeIntoDataStream: vi.fn(() => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: finalText,
            usage: { promptTokens: 100, completionTokens: 50 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 100 } } as never);
        }),
      } as never;
    });
  }

  it("extractPlanMethods:含 methods 代码块提取 id;无 methods/坏 DSL/无代码块返回空", async () => {
    const { extractPlanMethods } = await import("./handler");

    expect(extractPlanMethods(PLAN_BLOCK_TEXT)).toEqual(["pareto"]);

    const noMethods = PLAN_BLOCK_TEXT.replace(', ["pareto"]', "").replace("（方法：pareto）", "");
    expect(extractPlanMethods(noMethods)).toEqual([]);

    expect(extractPlanMethods("```openui\nroot = Root([insight])\n```")).toEqual([]);
    expect(extractPlanMethods("纯文字规划,没有代码块")).toEqual([]);

    // id 去重
    const dupText = PLAN_BLOCK_TEXT.replace('["pareto"]', '["pareto","pareto","trend"]');
    expect(extractPlanMethods(dupText)).toEqual(["pareto", "trend"]);
  });

  it("plan 模式 onFinish:提取 methods 并持久化 pendingPlan", async () => {
    mockPlanTextStream(PLAN_BLOCK_TEXT);
    const sessions = makeSessionsStub();
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager, sessions });

    await POST(
      makeRequest({ messages: [], apiKey: "k", sessionId: "sess_plan", mode: "plan" })
    );

    expect(sessions.updateContext).toHaveBeenCalledWith(
      "sess_plan",
      expect.objectContaining({ pendingPlan: { methodIds: ["pareto"] } })
    );
  });

  it("execute 模式:pendingPlan 精确注入方法详情并消费清空", async () => {
    mockPlanTextStream("执行中");
    const sessions = makeSessionsStub({ pendingPlan: { methodIds: ["pareto"] } });
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager, sessions });

    await POST(
      makeRequest({
        messages: [{ role: "assistant", content: "不含方法名的旧规划" }],
        apiKey: "k",
        sessionId: "sess_exec",
        mode: "execute",
      })
    );

    // system prompt 注入 pareto 卡详情(结构化主路径;散文匹配本应命不中该卡)
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(String(arg.system)).toContain("### Method pareto");
    // 消费后清空 pendingPlan
    expect(sessions.updateContext).toHaveBeenCalledWith(
      "sess_exec",
      expect.objectContaining({ pendingPlan: { methodIds: [] } })
    );
  });

  it("execute 模式无 pendingPlan:回退散文匹配并发 PLAN_FALLBACK_LEGACY 遥测", async () => {
    mockPlanTextStream("执行中");
    const sessions = makeSessionsStub(undefined);
    const telemetryEvents: Array<{ type: string; code?: string }> = [];
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({
      datasources: manager,
      sessions,
      telemetry: { emit: (e) => telemetryEvents.push(e as { type: string; code?: string }) },
    });

    await POST(
      makeRequest({
        messages: [
          {
            role: "assistant",
            content: "思路确认卡(方法:pareto + ranking),请确认以下分析方案。",
          },
        ],
        apiKey: "k",
        sessionId: "sess_legacy",
        mode: "execute",
      })
    );

    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(String(arg.system)).toContain("### Method pareto");
    expect(
      telemetryEvents.some((e) => e.type === "warn" && e.code === "PLAN_FALLBACK_LEGACY")
    ).toBe(true);
    // 未消费 pendingPlan:不写 pendingPlan 补丁(onFinish 的 token 锚点回写不受影响)
    const pendingPatches = vi
      .mocked(sessions.updateContext)
      .mock.calls.filter(([, patch]) => "pendingPlan" in patch);
    expect(pendingPatches).toHaveLength(0);
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
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager, telemetry: sink });
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
    vi.mocked(streamText).mockImplementation((opts) => {
      return {
        mergeIntoDataStream: vi.fn(() => {
          opts.onStepFinish?.({
            stepType: "text",
            toolCalls: [],
            finishReason: "stop",
            text: '分析报告……\n```openui\nroot = Root([insight])\ninsight = InsightBox("tip","结论","内容")\n```',
            usage: { promptTokens: 100, completionTokens: 50 },
          } as never);
          opts.onFinish?.({ usage: { promptTokens: 100 } } as never);
        }),
      } as never;
    });

    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(makeRequest({ messages: [], apiKey: "k" }));

    const arg = vi.mocked(streamText).mock.calls[0][0];
    const finishTool = arg.tools?.finish_task as unknown as {
      execute: (args: unknown) => Promise<{ terminated: boolean; status: string }>;
    };
    const result = await finishTool.execute({ status: "completed", summary: "完成" });
    expect(result.terminated).toBe(true);
    expect(result.status).toBe("completed");
  });
});
