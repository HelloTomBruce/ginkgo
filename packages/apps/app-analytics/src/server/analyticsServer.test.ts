// @vitest-environment node
/**
 * analytics 服务端工厂回归：从编排层（@openui-analytics/llm）下沉到应用包的
 * 领域行为——数据源工具装配与降级、跨源工具注册、三模式 prompt 分派、
 * schema 卡注入、认证口径注入、plan→execute 方法卡交接（pendingPlan）。
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalyticsServer } from "./index";
import { reloadCrossSourceMap } from "./crossSource";
import { extractPlanMethods } from "./planExtractor";
import { createDatasourceManager, type DatasourceManager } from "@openui-analytics/datasources";
import { createMethodLibrary, builtinMethodCards } from "../methodology";
import type { AppServerContext } from "@openui-analytics/app-sdk";

/** 真 manager 读临时配置文件；tools(IO) 覆写为 mock——等价迁移前 handler.test 的 fixture 语义 */
async function makeFakeManager(
  extraSources: Record<string, unknown>[] = []
): Promise<DatasourceManager> {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "analytics-server-")),
    "datasources.json"
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      sources: [
        {
          id: "jira",
          name: "Jira DB",
          kind: "db",
          dbType: "postgres",
          connectionString: "postgres://localhost/db",
          enabled: true,
        },
        ...extraSources,
      ],
    })
  );
  const real = createDatasourceManager({ configPath: file });
  const tools = vi.fn(async (): Promise<never[]> => []);
  return { ...real, tools } as unknown as DatasourceManager;
}

function makeCtx(
  overrides: Partial<AppServerContext> & {
    warn?: (code: string, detail: string) => void;
  } = {}
): AppServerContext {
  return {
    appId: "analytics",
    mode: "direct",
    messages: [{ role: "user", content: "分析各渠道 CAC" }],
    ...overrides,
  };
}

describe("createAnalyticsServer.getTools", () => {
  it("未指定 enabledSources 时装配全部启用源工具", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });

    const tools = await server.getTools(makeCtx());

    expect(manager.tools).toHaveBeenCalled();
    expect(Object.keys(tools)).not.toContain("cross_source_link");
  });

  it("单源工具加载失败时降级跳过该源并告警（warn 透传）", async () => {
    const manager = await makeFakeManager();
    vi.mocked(manager.tools).mockRejectedValueOnce(new Error("connection refused"));
    const server = createAnalyticsServer({ datasources: manager });
    const warn = vi.fn();

    const tools = await server.getTools(makeCtx({ warn: warn as never }));

    expect(Object.keys(tools)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "TOOL_LOAD_FAILED",
      expect.stringContaining("connection refused")
    );
  });

  it("enabledSources 未知 id 被忽略（resolveActive 语义），不装载任何源", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });

    await server.getTools(makeCtx({ enabledSources: ["nope"] }));

    expect(manager.tools).not.toHaveBeenCalled();
  });

  it("跨源 pair 配置且双侧源激活时注册 cross_source_link；单侧不注册", async () => {
    const pairFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "analytics-pair-")),
      "map.json"
    );
    fs.writeFileSync(
      pairFile,
      JSON.stringify({
        mappings: [
          { projectSource: "zentao-cli", project: "42", repoSource: "gitlab", repo: "backend/x" },
        ],
      })
    );
    reloadCrossSourceMap(pairFile);
    try {
      const manager = await makeFakeManager([
        { id: "zentao-cli", name: "禅道", kind: "db", dbType: "postgres", connectionString: "postgres://localhost/z", enabled: true },
        { id: "gitlab", name: "gitlab", kind: "db", dbType: "postgres", connectionString: "postgres://localhost/g", enabled: true },
      ]);
      const server = createAnalyticsServer({ datasources: manager });

      const withPair = await server.getTools(
        makeCtx({ enabledSources: ["zentao-cli", "gitlab"] })
      );
      expect(Object.keys(withPair)).toContain("cross_source_link");

      const singleSide = await server.getTools(makeCtx({ enabledSources: ["gitlab"] }));
      expect(Object.keys(singleSide)).not.toContain("cross_source_link");
    } finally {
      reloadCrossSourceMap("/nonexistent/cross-source-map.json");
    }
  });
});

describe("createAnalyticsServer.buildSystemPrompt", () => {
  it("direct 模式：数据源清单 + 方法索引 + 组件 kit 文档 + 平台注入防御段", async () => {
    const manager = await makeFakeManager();
    vi.mocked(manager.tools).mockResolvedValue([
      {
        name: "jira_execute_sql",
        originalName: "execute_sql",
        description: "d",
        inputSchema: { type: "object" },
        call: async () => ({}),
      },
    ] as never);
    const server = createAnalyticsServer({ datasources: manager });

    const system = await server.buildSystemPrompt(
      makeCtx({ activeSources: [{ id: "gitlab", name: "GitLab 协同", tools: ["gitlab_search"] }] })
    );

    expect(system).toContain("Jira DB");
    expect(system).toContain("jira_execute_sql");
    expect(system).toContain("GitLab 协同");
    expect(system).toContain("Analysis Method Index");
    expect(system).toContain("- trend: 趋势与同比环比");
    expect(system).toContain("## Visual Component Kit");
    expect(system).toContain("## Untrusted Data Handling");
    // 无跨源配对时不含跨源段
    expect(system).not.toContain("Cross-Source Joint Analysis");
  });

  it("plan 模式：注入 REQUIREMENT SCOPING 与 PlanReviewCard 契约；不含执行增量段", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });

    const system = await server.buildSystemPrompt(makeCtx({ mode: "plan" }));

    expect(system).toContain("REQUIREMENT SCOPING");
    expect(system).toContain("PlanReviewCard");
    expect(system).not.toContain("Confirmed Plan Execution Mode");
  });

  it("enabledSources 过滤：prompt 宣称的源 = 实际装配工具的源（防幻觉调用）", async () => {
    const manager = await makeFakeManager([
      { id: "warehouse", name: "数仓", kind: "db", dbType: "postgres", connectionString: "postgres://localhost/wh", enabled: true },
    ]);
    vi.mocked(manager.tools).mockImplementation(async (): Promise<never[]> => []);
    const server = createAnalyticsServer({ datasources: manager });

    // 只勾选 jira：prompt 不得宣称「数仓」可用
    const system = await server.buildSystemPrompt(
      makeCtx({ enabledSources: ["jira"] })
    );
    expect(system).toContain("Jira DB");
    expect(system).not.toContain("数仓");
  });

  it("execute 模式：注入执行增量段；pendingPlan 命中时注入方法详情并消费清空", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });
    const getContext = vi.fn(async () => ({ pendingPlan: { methodIds: ["pareto"] } }));
    const updateContext = vi.fn(async () => {});

    const system = await server.buildSystemPrompt(
      makeCtx({
        mode: "execute",
        sessionId: "sess_1",
        sessions: { getContext, updateContext } as never,
        messages: [{ role: "assistant", content: "不含方法名的旧规划" }],
      })
    );

    expect(system).toContain("Confirmed Plan Execution Mode");
    expect(system).toContain("### Method pareto");
    // 消费即清空
    expect(updateContext).toHaveBeenCalledWith(
      "sess_1",
      expect.objectContaining({ pendingPlan: { methodIds: [] } })
    );
  });

  it("execute 模式无 pendingPlan：回退散文匹配注入", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });
    const getContext = vi.fn(async () => undefined);
    const updateContext = vi.fn(async () => {});

    const system = await server.buildSystemPrompt(
      makeCtx({
        mode: "execute",
        sessionId: "sess_2",
        sessions: { getContext, updateContext } as never,
        messages: [
          { role: "assistant", content: "思路确认卡(方法:pareto + ranking),请确认以下分析方案。" },
        ],
      })
    );

    expect(system).toContain("### Method pareto");
    expect(updateContext).not.toHaveBeenCalledWith(
      "sess_2",
      expect.objectContaining({ pendingPlan: expect.anything() })
    );
  });

  it("启用源有结构卡时注入 Schema Cards 段；读卡失败静默降级", async () => {
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
    const server1 = createAnalyticsServer({
      datasources: { ...manager, getSchemaCard: withCard } as DatasourceManager,
    });
    const sys1 = await server1.buildSystemPrompt(makeCtx());
    expect(sys1).toContain("Schema Cards");
    expect(sys1).toContain("issues（约 42 行）");

    const broken = vi.fn(async () => {
      throw new Error("disk gone");
    });
    const server2 = createAnalyticsServer({
      datasources: { ...manager, getSchemaCard: broken } as DatasourceManager,
    });
    const sys2 = await server2.buildSystemPrompt(makeCtx());
    expect(sys2).not.toContain("Schema Cards");
  });

  it("userQuery 命中认证口径（exact）时注入权威口径约束段", async () => {
    const manager = await makeFakeManager();
    const certifiedFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "analytics-certified-")),
      "certified.json"
    );
    fs.writeFileSync(
      certifiedFile,
      JSON.stringify([
        {
          id: "q_cac",
          sourceId: "*",
          title: "获客成本 CAC",
          description: "CAC = 总投放花费 / 成交数",
          sqlTemplate: "SELECT SUM(spend)/SUM(deals) AS cac FROM marketing",
          tags: ["CAC", "获客成本", "渠道", "分析"],
        },
      ])
    );
    const { CertifiedQueryStore } = await import("@openui-analytics/datasources");
    const certifiedStore = new CertifiedQueryStore({ configPath: certifiedFile });
    const server = createAnalyticsServer({ datasources: manager, certifiedStore });

    const system = await server.buildSystemPrompt(makeCtx());

    expect(system).toContain("权威业务口径约束");
    expect(system).toContain("SELECT SUM(spend)/SUM(deals) AS cac FROM marketing");
  });
});

describe("createAnalyticsServer.onTaskFinish", () => {
  it("plan 模式：从最终文本提取 methods 写入 pendingPlan", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });
    const updateContext = vi.fn(async () => {});
    const planText =
      '思路确认（方法：pareto）\n```openui\nroot = Root([plan])\nplan = PlanReviewCard("投放 ROI 思路", undefined, undefined, [], undefined, "确认", ["pareto"])\n```';

    await server.onTaskFinish({
      sessionId: "sess_plan",
      mode: "plan",
      finalText: planText,
      sessions: { updateContext } as never,
    });

    expect(updateContext).toHaveBeenCalledWith(
      "sess_plan",
      expect.objectContaining({ pendingPlan: { methodIds: ["pareto"] } })
    );
  });

  it("非 plan 模式或无代码块：不写 pendingPlan", async () => {
    const manager = await makeFakeManager();
    const server = createAnalyticsServer({ datasources: manager });
    const updateContext = vi.fn(async () => {});

    await server.onTaskFinish({ sessionId: "s", mode: "direct", finalText: "x", sessions: { updateContext } as never });
    await server.onTaskFinish({ sessionId: "s", mode: "plan", finalText: "纯文字规划", sessions: { updateContext } as never });

    expect(updateContext).not.toHaveBeenCalled();
  });
});

describe("extractPlanMethods 单元回归", () => {
  const PLAN_BLOCK_TEXT =
    '规划（方法：pareto）\n```openui\nroot = Root([plan])\nplan = PlanReviewCard("渠道 CAC", undefined, undefined, [], undefined, "按此思路开始分析", ["pareto"])\n```';

  it("含 methods 代码块提取 id；无 methods/坏 DSL/无代码块返回空", () => {
    expect(extractPlanMethods(PLAN_BLOCK_TEXT)).toEqual(["pareto"]);
    const noMethods = PLAN_BLOCK_TEXT.replace(', ["pareto"]', "").replace("（方法：pareto）", "");
    expect(extractPlanMethods(noMethods)).toEqual([]);
    expect(extractPlanMethods("```openui\nroot = Root([insight])\n```")).toEqual([]);
    expect(extractPlanMethods("纯文字规划,没有代码块")).toEqual([]);
    const dupText = PLAN_BLOCK_TEXT.replace('["pareto"]', '["pareto","pareto","trend"]');
    expect(extractPlanMethods(dupText)).toEqual(["pareto", "trend"]);
  });
});

describe("方法论注入自定义库", () => {
  it("注入库的索引与 execute 详情来自注入卡（含用户卡覆盖）", async () => {
    const manager = await makeFakeManager();
    const custom = createMethodLibrary({
      builtin: builtinMethodCards,
      custom: [
        {
          id: "dora",
          name: "DORA 效能分析",
          when: "研发交付效能四指标",
          steps: ["计算部署频率", "对标基准"],
          chartPairing: ["AnalyticsChart"],
          executeGuidance: "Compute the four DORA metrics.",
        },
      ],
    });
    const server = createAnalyticsServer({ datasources: manager, methodology: custom.library });

    const direct = await server.buildSystemPrompt(makeCtx());
    expect(direct).toContain("Analysis Method Index");
    expect(direct).toContain("- trend: 趋势与同比环比");

    const execute = await server.buildSystemPrompt(
      makeCtx({
        mode: "execute",
        messages: [{ role: "assistant", content: "规划（方法 dora）" }],
      })
    );
    expect(execute).toContain("### Method dora · DORA 效能分析");
  });
});
