// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  getDistinctValues,
  clearDistinctCache,
  DISTINCT_VALUES_CAP,
  DISTINCT_TTL_MS,
  type DistinctGateway,
} from "./distinctValues";
import type { DynamicSourceConfig, McpConnection } from "@openui-analytics/datasources";

/**
 * distinct 拉取单元测试：TTL 缓存命中/过期、200 封顶哨兵、参数白名单、
 * 非 db 源 unsupported、未启用源拒绝。callTool mock 计数验证缓存命中。
 */

const PG: DynamicSourceConfig = {
  id: "pg1",
  name: "主库",
  kind: "db",
  dbType: "postgres",
  connectionString: "postgres://localhost/t",
  enabled: true,
};

const HTTP_SRC: DynamicSourceConfig = {
  id: "gl1",
  name: "GitLab",
  kind: "http-mcp",
  url: "http://localhost:3000",
  enabled: true,
};

function mcpRows(rows: Record<string, unknown>[]) {
  return {
    content: [{ type: "text", text: JSON.stringify({ rowCount: rows.length, rows }) }],
  };
}

type CallToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function makeGateway(callTool: CallToolFn, sources: DynamicSourceConfig[] = [PG, HTTP_SRC]) {
  let connectCount = 0;
  const gateway: DistinctGateway & { connectCount: () => number } = {
    get: (id) => sources.find((s) => s.id === id),
    connect: async () => {
      connectCount++;
      return { callTool } as unknown as McpConnection;
    },
    connectCount: () => connectCount,
  };
  return gateway;
}

const channelValues = [
  { channel: "TikTok Ads" },
  { channel: "Google Ads" },
  { channel: "线下展会" },
];

beforeEach(() => clearDistinctCache());

describe("getDistinctValues", () => {
  it("db 源：拉取去重值（排序 SQL + LIMIT 201）", async () => {
    let capturedSql = "";
    const gw = makeGateway(async (_name, args) => {
      capturedSql = String(args.sql);
      return mcpRows(channelValues);
    });
    const v = await getDistinctValues(gw, "pg1", "channel", "deals");
    expect(v).toMatchObject({ ok: true, values: ["TikTok Ads", "Google Ads", "线下展会"], truncated: false, cached: false });
    expect(capturedSql).toContain("SELECT DISTINCT channel AS channel FROM deals");
    expect(capturedSql).toContain(`LIMIT ${DISTINCT_VALUES_CAP + 1}`);
    expect(capturedSql).toContain("ORDER BY channel");
  });

  it("TTL 缓存命中：第二次调用不触达连接（cached=true）", async () => {
    const gw = makeGateway(async () => mcpRows(channelValues));
    await getDistinctValues(gw, "pg1", "channel", "deals");
    const v2 = await getDistinctValues(gw, "pg1", "channel", "deals");
    expect(v2).toMatchObject({ ok: true, cached: true });
    expect(gw.connectCount()).toBe(1);
  });

  it("TTL 过期（ttlMs=0）→ 重新拉取", async () => {
    const gw = makeGateway(async () => mcpRows(channelValues));
    await getDistinctValues(gw, "pg1", "channel", "deals");
    const v2 = await getDistinctValues(gw, "pg1", "channel", "deals", { ttlMs: 0 });
    expect(v2).toMatchObject({ ok: true, cached: false });
    expect(gw.connectCount()).toBe(2);
  });

  it("默认 TTL 常量为 5 分钟", () => {
    expect(DISTINCT_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("超 200 条 → truncated 哨兵，只返回前 200", async () => {
    const many = Array.from({ length: DISTINCT_VALUES_CAP + 30 }, (_, i) => ({
      channel: `v${i}`,
    }));
    const gw = makeGateway(async () => mcpRows(many));
    const v = await getDistinctValues(gw, "pg1", "channel", "deals");
    expect(v.ok && v.values).toHaveLength(DISTINCT_VALUES_CAP);
    expect(v.ok && v.truncated).toBe(true);
  });

  it("参数形态不合法 → invalid-params（不触达源）", async () => {
    const gw = makeGateway(async () => mcpRows(channelValues));
    const cases = [
      getDistinctValues(gw, "Bad Source", "channel", "deals"),
      getDistinctValues(gw, "pg1", "1field", "deals"),
      getDistinctValues(gw, "pg1", "channel", "t; DROP"),
    ];
    for (const p of cases) {
      expect((await p).ok).toBe(false);
    }
    expect(gw.connectCount()).toBe(0);
  });

  it("非 db 源 → unsupported（不触达连接）", async () => {
    const gw = makeGateway(async () => mcpRows(channelValues), [HTTP_SRC]);
    const v = await getDistinctValues(gw, "gl1", "state", "issues");
    expect(v).toMatchObject({ ok: false, reason: "unsupported" });
    expect(gw.connectCount()).toBe(0);
  });

  it("源停用 → source-unavailable", async () => {
    const disabled = { ...PG, enabled: false };
    const gw = makeGateway(async () => mcpRows(channelValues), [disabled]);
    const v = await getDistinctValues(gw, "pg1", "channel", "deals");
    expect(v).toMatchObject({ ok: false, reason: "source-unavailable" });
  });

  it("连接失败 → source-unavailable（带 detail）", async () => {
    const gw: DistinctGateway = {
      get: () => PG,
      connect: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const v = await getDistinctValues(gw, "pg1", "channel", "deals");
    expect(v).toMatchObject({ ok: false, reason: "source-unavailable" });
  });

  it("execute_sql 失败 → query-failed", async () => {
    const gw = makeGateway(async () => {
      throw new Error("relation does not exist");
    });
    const v = await getDistinctValues(gw, "pg1", "channel", "deals");
    expect(v).toMatchObject({ ok: false, reason: "query-failed" });
  });
});
