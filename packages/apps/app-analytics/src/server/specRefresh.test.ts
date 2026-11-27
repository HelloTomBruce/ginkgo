// @vitest-environment node
import { describe, it, expect } from "vitest";
import { refreshDashboard, type RefreshGateway } from "./dashboardRefresh";
import type { DynamicSourceConfig, McpConnection } from "@ginkgolab/datasources";
import type { DashboardRecord } from "./dashboardStore";

/**
 * SpecChart 刷新集成：按声明 spec 物化回填（零 LLM）。
 * - spec-only 看板可刷新（不再 readonly）
 * - describe_table 字段校验 → execute_sql 物化 → data 回填
 * - 幻觉字段/缺表名 → 节点级 stale 不整体失败
 * - 改 chartType 不换绑定（刷新后 spec 保持、data 更新）
 */

const PG_SOURCE: DynamicSourceConfig = {
  id: "pg1",
  name: "主库",
  kind: "db",
  dbType: "postgres",
  connectionString: "postgres://localhost/t",
  enabled: true,
};

const SPEC_COLUMNS = {
  content: [
    {
      type: "text",
      text: JSON.stringify([
        { column: "province", type: "text" },
        { column: "capacity", type: "numeric" },
      ]),
    },
  ],
};

const SPEC_ROWS = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        rowCount: 2,
        rows: [
          { province: "广东", capacity: 10 },
          { province: "江苏", capacity: 8 },
        ],
      }),
    },
  ],
};

function mcpOk(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

type CallToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function makeGateway(callTool: CallToolFn): RefreshGateway {
  return {
    get: (id) => (id === "pg1" ? PG_SOURCE : undefined),
    connect: async () =>
      ({ callTool }) as unknown as McpConnection,
  };
}

function seedRecord(dsl: string): DashboardRecord {
  return {
    id: "dash_spec0001",
    title: "spec 看板",
    dsl,
    createdAt: 1,
    updatedAt: 2,
  };
}

const SPEC_DSL = [
  "root = Root([chart])",
  'chart = SpecChart("各省容量", {"dims":[{"field":"province"}],"meas":[{"field":"capacity","agg":"sum","label":"容量"}],"chartType":"donut","sourceId":"pg1"}, "power_stats", [{"province":"广东","capacity":1}])',
].join("\n");

describe("SpecChart 刷新集成", () => {
  it("spec-only 看板：describe → execute_sql → data 回填，零 stale", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const gateway = makeGateway(async (name, args) => {
      calls.push({ name, args });
      if (name === "describe_table") return SPEC_COLUMNS;
      if (name === "execute_sql") return SPEC_ROWS;
      throw new Error(`unexpected tool ${name}`);
    });
    const verdict = await refreshDashboard(seedRecord(SPEC_DSL), gateway);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.stale).toEqual([]);
      expect(verdict.dsl).toContain("capacity: 10");
      expect(verdict.dsl).toContain("capacity: 8");
    }
    // execute_sql 携带参数化 SQL（GROUP BY province + LIMIT）
    const exec = calls.find((c) => c.name === "execute_sql");
    expect(exec).toBeDefined();
    expect(String(exec?.args.sql)).toContain("GROUP BY province");
    expect(String(exec?.args.sql)).toContain("LIMIT 200");
  });

  it("幻觉字段：spec-only 唯一声明物化失败 → 整体 replay-failed（无新数据不落盘）", async () => {
    const gateway = makeGateway(async (name) => {
      if (name === "describe_table")
        return mcpOk([{ column: "province", type: "text" }]); // 缺 capacity 列
      return SPEC_ROWS;
    });
    const verdict = await refreshDashboard(seedRecord(SPEC_DSL), gateway);
    expect(verdict).toMatchObject({ ok: false, reason: "replay-failed" });
  });

  it("幻觉字段 + 混合查询：仅 spec 节点 stale，查询照常回填", async () => {
    // 混合看板：一个 AnalyticsChart（走 queries 重放）+ 一个幻觉字段 SpecChart
    const record: DashboardRecord = {
      ...seedRecord([
        "root = Root([chart, spec])",
        'chart = AnalyticsChart("bar", "渠道", "", "channel", [{"channel":"A","deals":1}], [{"key":"deals"}])',
        'spec = SpecChart("各省容量", {"dims":[{"field":"province"}],"meas":[{"field":"ghost","agg":"sum"}],"chartType":"bar","sourceId":"pg1"}, "power_stats", [{"province":"广东","ghost":1}])',
      ].join("\n")),
      queries: [{ id: "q_00af5f39", sourceId: "pg1", kind: "sql", payload: "SELECT channel, deals FROM deals" }],
      bindings: { chart: "q_00af5f39" },
    };
    const gateway = makeGateway(async (name, args) => {
      if (name === "describe_table")
        return mcpOk([{ column: "province", type: "text" }]);
      if (name === "execute_sql") {
        // 渠道查询重放（bindings 通道）返回对应行
        if (String(args.sql).startsWith("SELECT channel")) {
          return mcpOk({
            rowCount: 2,
            rows: [
              { channel: "A", deals: 1 },
              { channel: "B", deals: 2 },
            ],
          });
        }
        return mcpOk({ rowCount: 0, rows: [] }); // spec 物化（describe 已拦，不应到达）
      }
      throw new Error(`unexpected tool ${name}`);
    });
    const verdict = await refreshDashboard(record, gateway);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.stale).toEqual(["spec"]);
      expect(verdict.dsl).toContain("deals: 2"); // 查询通道照常回填
    }
  });

  it("缺表名（table prop 缺省）→ spec-only 唯一声明失败 → 整体 replay-failed", async () => {
    const dsl = SPEC_DSL.replace(', "power_stats", [{"province":"广东","capacity":1}]', ", [{\"province\":\"广东\",\"capacity\":1}]");
    const gateway = makeGateway(async () => SPEC_ROWS);
    const verdict = await refreshDashboard(seedRecord(dsl), gateway);
    expect(verdict).toMatchObject({ ok: false, reason: "replay-failed" });
  });

  it("spec.sourceId 缺省 + defaultSourceId → 正常物化", async () => {
    const dsl = SPEC_DSL.replace('"sourceId":"pg1", ', "");
    const gateway = makeGateway(async (name) =>
      name === "describe_table" ? SPEC_COLUMNS : SPEC_ROWS
    );
    const verdict = await refreshDashboard(seedRecord(dsl), gateway, "pg1");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.stale).toEqual([]);
  });

  it("改 chartType（donut→bar）不换绑定：刷新仍按同一 spec 物化", async () => {
    const dsl = SPEC_DSL.replace('"chartType":"donut"', '"chartType":"bar"');
    const gateway = makeGateway(async (name) =>
      name === "describe_table" ? SPEC_COLUMNS : SPEC_ROWS
    );
    const verdict = await refreshDashboard(seedRecord(dsl), gateway);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.stale).toEqual([]);
      expect(verdict.dsl).toContain('chartType: "bar"');
      expect(verdict.dsl).toContain("capacity: 10");
    }
  });

  it("queries 与 SpecChart 均无 → readonly（旧快照语义不变）", async () => {
    const dsl = 'root = Root([t])\nt = DataTable("明细", [], [{"a":1}])';
    const gateway = makeGateway(async () => SPEC_ROWS);
    const verdict = await refreshDashboard(seedRecord(dsl), gateway);
    expect(verdict).toMatchObject({ ok: false, reason: "readonly" });
  });
});

describe("MCP 源退化通道（M3-1）", () => {
  const HTTP_SOURCE: DynamicSourceConfig = {
    id: "gl1",
    name: "GitLab",
    kind: "file",
    enabled: true,
  };
  const MCP_SPEC_DSL = [
    "root = Root([chart])",
    'chart = SpecChart("问题状态分布", {"dims":[{"field":"state"}],"meas":[{"field":"id","agg":"count","label":"数量"}],"chartType":"donut","sourceId":"gl1","toolQuery":{"tool":"list_issues","args":{"scope":"all"}}}, "issues", [{"state":"opened","id":1},{"state":"opened","id":2},{"state":"closed","id":3}])',
  ].join("\n");

  function makeHttpGateway(callTool: CallToolFn): RefreshGateway {
    return {
      get: (id) => (id === "gl1" ? HTTP_SOURCE : undefined),
      connect: async () => ({ callTool }) as unknown as McpConnection,
    };
  }

  it("MCP 源 + toolQuery → 行谓词 + TransformSpec 聚合回填", async () => {
    const gateway = makeHttpGateway(async (name) => {
      if (name !== "list_issues") throw new Error(`unexpected ${name}`);
      return mcpOk({
        rows: [
          { state: "opened", id: 1 },
          { state: "opened", id: 2 },
          { state: "closed", id: 3 },
        ],
      });
    });
    const verdict = await refreshDashboard(seedRecord(MCP_SPEC_DSL), gateway);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.stale).toEqual([]);
      // 聚合后：opened=2, closed=1（count 指标）
      expect(verdict.dsl).toContain("id: 2");
      expect(verdict.dsl).toContain("id: 1");
    }
  });

  it("MCP 源未声明 toolQuery → 节点级 stale（spec-only 整体 replay-failed）", async () => {
    const dsl = MCP_SPEC_DSL.replace('"toolQuery":{"tool":"list_issues","args":{"scope":"all"}}, ', "");
    const gateway = makeHttpGateway(async () => mcpOk({ rows: [] }));
    const verdict = await refreshDashboard(seedRecord(dsl), gateway);
    expect(verdict).toMatchObject({ ok: false, reason: "replay-failed" });
  });
});
