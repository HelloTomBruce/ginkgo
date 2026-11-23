// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getUiSpecSystemPrompt,
  getUiSpecPlanPrompt,
  getExecuteSystemPrompt,
} from "./prompt";
import { reloadCrossSourceMap } from "./crossSource";
import type { ActiveSourceSummary } from "@ginkgo/datasources";

const ACTIVE: ActiveSourceSummary[] = [
  {
    id: "mysql-orders",
    name: "订单库",
    kind: "db",
    dbType: "mysql",
    tools: ["mysql-orders_execute_sql", "mysql-orders_list_tables"],
  },
  {
    id: "zentao-cli",
    name: "禅道",
    kind: "db",
    dbType: "postgres",
    tools: ["zentao-cli_zentao_bug"],
  },
];

/** 禅道 + GitLab 成对激活：跨源联合分析能力才注入 */
const PAIRED: ActiveSourceSummary[] = [
  ...ACTIVE,
  {
    id: "gitlab",
    name: "gitlab",
    kind: "db",
    dbType: "postgres",
    tools: ["gitlab_list_commits"],
  },
];

describe("getUiSpecSystemPrompt 全动态数据源段", () => {
  it("Data Access 段完全由激活源生成：源名/kind/工具", () => {
    const prompt = getUiSpecSystemPrompt(ACTIVE);

    expect(prompt).toContain("订单库");
    expect(prompt).toContain("mysql-orders_execute_sql");
    expect(prompt).toContain("禅道");
    expect(prompt).toContain("zentao-cli_zentao_bug");
    // 无内置静态段残留
    expect(prompt).not.toContain("PostgreSQL Analytics Database");
    expect(prompt).not.toContain("GitLab Repository");
  });

  it("空源列表仍生成可用 prompt", () => {
    const prompt = getUiSpecSystemPrompt([]);
    expect(prompt).toContain("## Data Access:");
    expect(prompt).not.toContain("PostgreSQL Analytics Database");
  });
});

describe("跨源联合分析条件注入（pair 配置 + 双侧源激活才出现）", () => {
  // pair 配置由用户维护（config/cross-source-map.json），测试用临时文件注入
  const pairFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "prompt-pair-")),
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

  beforeEach(() => {
    reloadCrossSourceMap(pairFile);
  });
  afterEach(() => {
    reloadCrossSourceMap("/nonexistent/cross-source-map.json");
  });

  it("仅激活 pair 单侧源：不出现 cross_source_link 与跨源规则段", () => {
    const prompt = getUiSpecSystemPrompt(ACTIVE);
    expect(prompt).not.toContain("cross_source_link");
    expect(prompt).not.toContain("Cross-Source Joint Analysis");
  });

  it("pair 双侧源激活：注入映射工具说明与跨源规则段（含源展示名）", () => {
    const prompt = getUiSpecSystemPrompt(PAIRED);
    expect(prompt).toContain("cross_source_link");
    expect(prompt).toContain("Cross-Source Joint Analysis");
    expect(prompt).toContain("gitlab_list_commits");
    // 规则段使用配置的源名而非写死的产品名
    expect(prompt).toContain("禅道 × gitlab");
  });

  it("plan/execute 提示词同样按 pair 配置条件注入", () => {
    expect(getUiSpecPlanPrompt(ACTIVE)).not.toContain("cross_source_link");
    expect(getUiSpecPlanPrompt(PAIRED)).toContain("cross_source_link");
    expect(getExecuteSystemPrompt(ACTIVE)).not.toContain("Cross-Source Joint Analysis");
    expect(getExecuteSystemPrompt(PAIRED)).toContain("Cross-Source Joint Analysis");
  });
});

describe("getUiSpecPlanPrompt 规划模式提示词", () => {
  it("复用动态数据源段，并含规划契约与探查边界", () => {
    const prompt = getUiSpecPlanPrompt(ACTIVE);

    // 动态数据源段照常生成
    expect(prompt).toContain("订单库");
    expect(prompt).toContain("mysql-orders_list_tables");
    // 仅有禅道无 GitLab：不注入跨源探查说明
    expect(prompt).not.toContain("cross_source_link");
    // 规划模式标识与输出契约
    expect(prompt).toContain("Planning Mode");
    expect(prompt).toContain("PlanReviewCard");
    expect(prompt).toContain("LIMIT");
    // 严禁直出看板的约束
    expect(prompt).toContain("NOT producing the final dashboard");
    // 方案 A：模糊输入意图分流与反问指引
    expect(prompt).toContain("Ambiguous or Broad Input Screening");
    expect(prompt).toContain("Intent Ambiguity Screening");
  });
});

describe("getExecuteSystemPrompt 执行模式提示词", () => {
  it("base 提示词完整保留 + 执行增量约束追加", () => {
    const prompt = getExecuteSystemPrompt(ACTIVE);
    const base = getUiSpecSystemPrompt(ACTIVE);

    // base 全量保留（组件规范/数据源段/跨源规则）
    expect(prompt).toContain(base);
    // 执行增量约束
    expect(prompt).toContain("Confirmed Plan Execution Mode");
    expect(prompt).toContain("REVISED PlanReviewCard");
    // 交付物分级适配约束
    expect(prompt).toContain("Deliverable Adaptation");
    expect(prompt).toContain("Summary-Only Mode");
  });
});

describe("Data Binding Discipline（可刷新看板约束）", () => {
  it("direct 含聚合下推/命名绑定/原样复用三条硬约束", () => {
    const prompt = getUiSpecSystemPrompt(ACTIVE);
    expect(prompt).toContain("Data Binding Discipline");
    // 聚合下推 SQL
    expect(prompt).toContain("Push aggregation down to SQL");
    expect(prompt).toContain("Aggregate in SQL, not in your head");
    // 命名变量绑定（statementId 来源）
    expect(prompt).toContain("Assign every data component to a named variable");
    expect(prompt).toContain("named variable");
    // 行原样复用（直取匹配的前提）
    expect(prompt).toContain("reuse query result rows verbatim");
  });

  it("execute 继承同一套约束（base 包含）；plan 不含（规划轮不出看板）", () => {
    expect(getExecuteSystemPrompt(ACTIVE)).toContain("Data Binding Discipline");
    expect(getUiSpecPlanPrompt(ACTIVE)).not.toContain(
      "Data Binding Discipline"
    );
  });
});

describe("Schema Card 摘要注入（三模式）", () => {
  const DIGEST = "### 数据源 mysql-orders 结构卡（生成于 2026-11-02 10:30）\n- orders（约 1,234 行）：status text(3 值: paid/shipped/refunded)";

  it("direct / plan / execute 三种模式都携带同一结构卡段", () => {
    expect(getUiSpecSystemPrompt(ACTIVE, DIGEST)).toContain(DIGEST);
    expect(getUiSpecPlanPrompt(ACTIVE, DIGEST)).toContain(DIGEST);
    expect(getExecuteSystemPrompt(ACTIVE, DIGEST)).toContain(DIGEST);
  });

  it("注入段带「优先复用卡」引导语；缺省不注入（向后兼容）", () => {
    const withCard = getUiSpecSystemPrompt(ACTIVE, DIGEST);
    expect(withCard).toContain("Schema Cards");
    expect(withCard).toContain("Prefer them over calling list_tables/describe_table");

    const without = getUiSpecSystemPrompt(ACTIVE);
    expect(without).not.toContain("Schema Cards");
    expect(without).not.toContain("结构卡");
  });
});

describe("结构卡预算常量守护（防回归快照）", () => {
  it("datasources 包预算常量与 handler 总量预算符合契约", async () => {
    const {
      CARD_RENDER_BUDGET_BYTES,
      CARD_STORE_MAX_BYTES,
      LOW_CARDINALITY_THRESHOLD,
    } = await import("@ginkgo/datasources");
    const { SCHEMA_DIGEST_TOTAL_BUDGET_BYTES } = await import("./schemaDigest");

    // 契约快照：单卡渲染 ≤2KB；落盘 ≤64KB；总量 ≤8KB；低基数阈值 50
    expect({
      perCardRender: CARD_RENDER_BUDGET_BYTES,
      storeMax: CARD_STORE_MAX_BYTES,
      totalDigest: SCHEMA_DIGEST_TOTAL_BUDGET_BYTES,
      lowCardinality: LOW_CARDINALITY_THRESHOLD,
    }).toMatchInlineSnapshot(`
      {
        "lowCardinality": 50,
        "perCardRender": 2048,
        "storeMax": 65536,
        "totalDigest": 8192,
      }
    `);
  });
});

describe("方法论注入（三模式）", () => {
  const INDEX = "## Analysis Method Index (pick by the question's intent):\n- trend: 趋势与同比环比 — 指标随时间如何变化";
  const DETAILS = "### Method pareto · 构成与帕累托\nCharts: AnalyticsChart + MetricGrid";

  it("direct / plan 携带方法索引与选法引导；execute 携带详情与遵循指令", () => {
    const direct = getUiSpecSystemPrompt(ACTIVE, undefined, INDEX);
    expect(direct).toContain("Analysis Method Index");
    expect(direct).toContain("NAME them in the dashboard title");

    const plan = getUiSpecPlanPrompt(ACTIVE, undefined, INDEX);
    expect(plan).toContain("Analysis Method Index");
    expect(plan).toContain("Method Selection");
    expect(plan).toContain("1-2 methods");

    const exec = getExecuteSystemPrompt(ACTIVE, undefined, DETAILS);
    expect(exec).toContain("### Method pareto");
    expect(exec).toContain("follow their detailed guidance strictly");
    // execute 不重复注入索引（按需详情替代全量索引）
    expect(exec).not.toContain("Analysis Method Index");
  });

  it("缺省不注入（向后兼容）", () => {
    expect(getUiSpecSystemPrompt(ACTIVE)).not.toContain("Analysis Method Index");
    expect(getUiSpecPlanPrompt(ACTIVE)).not.toContain("Method Selection");
    expect(getExecuteSystemPrompt(ACTIVE)).not.toContain("Method pareto");
  });

  it("索引预算常量契约快照（methodology 包）", async () => {
    const {
      INDEX_BUDGET_BYTES,
      DETAIL_BUDGET_BYTES,
      renderMethodIndex,
      builtinMethodCards,
    } = await import("../methodology");
    expect({
      index: INDEX_BUDGET_BYTES,
      detail: DETAIL_BUDGET_BYTES,
    }).toMatchInlineSnapshot(`
      {
        "detail": 600,
        "index": 1024,
      }
    `);
    // 内置 10 卡索引实渲染在预算内
    const text = renderMethodIndex(builtinMethodCards);
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(INDEX_BUDGET_BYTES);
  });
});

describe("模式语义隔离（回归：direct 引导语泄漏进 plan 造成矛盾指令）", () => {
  const INDEX = "## Analysis Method Index (pick by the question's intent):\n- trend: 趋势与同比环比 — 指标随时间如何变化";

  it("plan prompt 不含「写进看板标题」等 direct 专属措辞", () => {
    const plan = getUiSpecPlanPrompt(ACTIVE, undefined, INDEX);
    expect(plan).not.toContain("dashboard title");
    expect(plan).not.toContain("NAME them in the dashboard");
    // plan 的选法指令指向 PlanReviewCard
    expect(plan).toContain("PlanReviewCard title or a step's detail");
  });

  it("direct prompt 保留方法命名引导（看板标题/洞察）", () => {
    const direct = getUiSpecSystemPrompt(ACTIVE, undefined, INDEX);
    expect(direct).toContain("NAME them in the dashboard title or insights");
  });
});
