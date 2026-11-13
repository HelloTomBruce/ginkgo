import { describe, it, expect, vi } from "vitest";
import { dryRunExplain } from "./explainGuard";
import type { DbDialectClient } from "../connectors/db/sqlGuard";

describe("dryRunExplain 执行计划与成本门禁", () => {
  it("Postgres 执行计划解析：识别全表扫描 Seq Scan 与行数", async () => {
    const mockClient: DbDialectClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            "QUERY PLAN": JSON.stringify([
              {
                Plan: {
                  "Node Type": "Seq Scan",
                  "Relation Name": "huge_table",
                  "Plan Rows": 2_500_000,
                },
              },
            ]),
          },
        ],
        rowCount: 1,
      }),
      close: vi.fn(),
    };

    const report = await dryRunExplain(
      mockClient,
      "postgres",
      "SELECT * FROM huge_table",
      { maxScanRowsBudget: 1_000_000 }
    );

    expect(report.isValid).toBe(true);
    expect(report.estimatedRows).toBe(2_500_000);
    expect(report.isFullTableScan).toBe(true);
    expect(report.exceedsBudget).toBe(true);
    expect(report.costWarning).toContain("成本门禁拦截");
  });

  it("MySQL 执行计划解析：识别 ALL 全表扫描", async () => {
    const mockClient: DbDialectClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            EXPLAIN: JSON.stringify({
              query_block: {
                table: {
                  table_name: "orders",
                  access_type: "ALL",
                  rows_examined_per_scan: 600_000,
                },
              },
            }),
          },
        ],
        rowCount: 1,
      }),
      close: vi.fn(),
    };

    const report = await dryRunExplain(
      mockClient,
      "mysql",
      "SELECT * FROM orders",
      { maxScanRowsBudget: 1_000_000, blockFullTableScan: true }
    );

    expect(report.isValid).toBe(true);
    expect(report.estimatedRows).toBe(600_000);
    expect(report.isFullTableScan).toBe(true);
    expect(report.exceedsBudget).toBe(false);
    expect(report.costWarning).toContain("成本门禁警告");
  });

  it("语法错误或表不存在时优雅拦截", async () => {
    const mockClient: DbDialectClient = {
      query: vi.fn().mockRejectedValue(new Error('relation "non_exist" does not exist')),
      close: vi.fn(),
    };

    const report = await dryRunExplain(
      mockClient,
      "postgres",
      "SELECT * FROM non_exist"
    );

    expect(report.isValid).toBe(false);
    expect(report.syntaxError).toContain("does not exist");
    expect(report.costWarning).toContain("执行计划预检失败");
  });

  it("参数化查询：params 透传绑定到 EXPLAIN，避免未绑定占位符被误判为语法错误", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          "QUERY PLAN": JSON.stringify([
            { Plan: { "Node Type": "Index Scan", "Plan Rows": 120 } },
          ]),
        },
      ],
      rowCount: 1,
    });
    const mockClient: DbDialectClient = { query: queryMock, close: vi.fn() };

    const report = await dryRunExplain(
      mockClient,
      "postgres",
      "SELECT * FROM orders WHERE created_at >= $1",
      undefined,
      ["2026-01-01"]
    );

    expect(report.isValid).toBe(true);
    expect(report.estimatedRows).toBe(120);
    expect(queryMock).toHaveBeenCalledWith(
      "EXPLAIN (FORMAT JSON) SELECT * FROM orders WHERE created_at >= $1",
      ["2026-01-01"]
    );
  });

  it("EXPLAIN 变体不受方言支持时优雅降级放行，而非熔断整个数据源", async () => {
    const mockClient: DbDialectClient = {
      query: vi
        .fn()
        .mockRejectedValue(new Error("Unknown statement type EXPLAIN ESTIMATE")),
      close: vi.fn(),
    };

    const report = await dryRunExplain(
      mockClient,
      "clickhouse",
      "SELECT * FROM events"
    );

    expect(report.isValid).toBe(true);
    expect(report.degraded).toBe(true);
    expect(report.costWarning).toContain("已降级为直接执行");
  });

  it("连接类基础设施异常同样降级放行", async () => {
    const mockClient: DbDialectClient = {
      query: vi.fn().mockRejectedValue(new Error("Connection refused")),
      close: vi.fn(),
    };

    const report = await dryRunExplain(mockClient, "mysql", "SELECT 1");

    expect(report.isValid).toBe(true);
    expect(report.degraded).toBe(true);
  });
});
