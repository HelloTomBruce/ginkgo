// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * preview-query 路由集成：图表级声明物化（筛选联动取数端点，零 LLM）。
 * datasources 单例 mock（连接/execute_sql/describe_table 走内存信封）。
 */

const PG_SOURCE = {
  id: "pg1",
  name: "主库",
  kind: "db" as const,
  dbType: "postgres" as const,
  connectionString: "postgres://localhost/t",
  enabled: true,
};

const mcpRows = (rows: Record<string, unknown>[]) => ({
  content: [{ type: "text", text: JSON.stringify({ rowCount: rows.length, rows }) }],
});

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/lib/datasources", () => ({
  datasources: {
    get: (id: string) => (id === "pg1" ? PG_SOURCE : undefined),
    connect: mocks.connect,
  },
}));

mocks.connect.mockResolvedValue({ callTool: mocks.callTool });
mocks.callTool.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
  if (args.table_name) {
    return {
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
  }
  return mcpRows([{ province: "江苏", capacity: 42 }]);
});

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/dashboards/preview-query", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

const validSpec = {
  dims: [{ field: "province" }],
  meas: [{ field: "capacity", agg: "sum" }],
  chartType: "bar",
  sourceId: "pg1",
  filters: [{ field: "province", op: "eq", value: "江苏" }],
};

describe("POST /api/dashboards/preview-query", () => {
  beforeEach(() => {
    mocks.callTool.mockClear();
    mocks.connect.mockClear();
  });

  it("合法声明 → 200 rows（筛选值随 spec 物化）", async () => {
    const res = await post({ sourceId: "pg1", table: "power_stats", spec: validSpec });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([{ province: "江苏", capacity: 42 }]);
    // execute_sql 的 SQL 含 WHERE 参数化筛选
    const exec = mocks.callTool.mock.calls.find(([n]) => n === "execute_sql");
    expect(String(exec?.[1].sql)).toContain("WHERE province = ?");
  });

  it("spec 形态非法 → 400", async () => {
    const res = await post({ sourceId: "pg1", table: "t", spec: { dims: [] } });
    expect(res.status).toBe(400);
  });

  it("表名不合法 → 400", async () => {
    const res = await post({ sourceId: "pg1", table: "t; DROP", spec: validSpec });
    expect(res.status).toBe(400);
  });

  it("缺 sourceId → 400", async () => {
    const res = await post({ table: "t", spec: validSpec });
    expect(res.status).toBe(400);
  });

  it("源不存在 → 404", async () => {
    const res = await post({ sourceId: "nope", table: "t", spec: validSpec });
    expect(res.status).toBe(404);
  });

  it("源停用 → 404", async () => {
    // manager.get 返回不存在 id 走同一 404 分支（停用态由 manager 层折叠为不可用）
    const res = await post({ sourceId: "pg2", table: "t", spec: validSpec });
    expect(res.status).toBe(404);
  });

  it("幻觉字段（describe 校验）→ 400 附 missing", async () => {
    mocks.callTool.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      if (args.table_name) {
        return {
          content: [
            { type: "text", text: JSON.stringify([{ column: "province", type: "text" }]) },
          ],
        };
      }
      return mcpRows([]);
    });
    const res = await post({ sourceId: "pg1", table: "power_stats", spec: validSpec });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing).toContain("capacity");
  });

  it("物化执行失败 → 502", async () => {
    mocks.callTool.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      if (args.table_name) {
        return {
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
      }
      throw new Error("relation does not exist");
    });
    const res = await post({ sourceId: "pg1", table: "power_stats", spec: validSpec });
    expect(res.status).toBe(502);
  });
});
