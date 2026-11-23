import { describe, it, expect, vi } from "vitest";
import { toAiTools } from "./ai";
import type { McpToolBinding } from "../manager";

describe("toAiTools", () => {
  it("正常执行时返回 binding.call 结果", async () => {
    const binding: McpToolBinding = {
      name: "ds_execute_sql",
      originalName: "execute_sql",
      description: "执行 SQL 查询",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
      },
      call: vi.fn(async () => ({ rowCount: 1, rows: [{ a: 1 }] })),
    };

    const tools = toAiTools([binding]);
    expect(tools.ds_execute_sql).toBeDefined();

    const result = await tools.ds_execute_sql.execute!({ sql: "SELECT 1" }, {} as never);
    expect(result).toEqual({ rowCount: 1, rows: [{ a: 1 }] });
    expect(binding.call).toHaveBeenCalledWith({ sql: "SELECT 1" });
  });

  it("binding.call 抛出异常时捕获并返回 { error, isError: true } 供模型自愈", async () => {
    const binding: McpToolBinding = {
      name: "ds_execute_sql",
      originalName: "execute_sql",
      description: "执行 SQL 查询",
      inputSchema: { type: "object" },
      call: vi.fn(async () => {
        throw new Error(
          'SQL 执行失败: Binder Error: Referenced column "专业" not found'
        );
      }),
    };

    const tools = toAiTools([binding]);
    const result = (await tools.ds_execute_sql.execute!({}, {} as never)) as {
      error: string;
      isError: boolean;
    };

    expect(result).toEqual({
      error: 'SQL 执行失败: Binder Error: Referenced column "专业" not found',
      isError: true,
    });
  });

  it("WS-5 超限结果信封化:头尾保留 + 来源标注 + truncated 标记,常规结果原样透传", async () => {
    const bigRows = Array.from({ length: 5000 }, (_, i) => ({ id: i, payload: `数据-${i}` }));
    const binding: McpToolBinding = {
      name: "pg_execute_sql",
      originalName: "execute_sql",
      description: "执行 SQL 查询",
      inputSchema: { type: "object" },
      call: vi.fn(async () => ({ rowCount: bigRows.length, rows: bigRows })),
    };

    const tools = toAiTools([binding], { sourceId: "pg", maxOutputBytes: 4096 });

    // 超限:转信封
    const big = (await tools.pg_execute_sql.execute!({}, {} as never)) as {
      output?: string;
      truncated?: boolean;
      originalBytes?: number;
      rowCount?: number;
    };
    expect(big.truncated).toBe(true);
    expect(big.originalBytes).toBeGreaterThan(4096);
    expect(big.rowCount).toBeUndefined(); // 原形状被替换
    expect(big.output).toContain('<tool_output source="pg" tool="execute_sql" untrusted="true">');
    expect(big.output).toContain("已截断");
    expect(big.output).toContain("</tool_output>");
    // 头尾保留:开头含首行数据,结尾含末行数据
    expect(big.output).toContain("数据-0");
    expect(big.output).toContain(`数据-${bigRows.length - 1}`);

    // 常规小结果:原样透传(形状不变,UI 解析无感知)
    const smallBinding: McpToolBinding = { ...binding, call: vi.fn(async () => ({ ok: 1 })) };
    const smallTools = toAiTools([smallBinding], { sourceId: "pg", maxOutputBytes: 4096 });
    const small = await smallTools.pg_execute_sql.execute!({}, {} as never);
    expect(small).toEqual({ ok: 1 });
  });
});
