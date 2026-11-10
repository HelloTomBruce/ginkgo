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
});
