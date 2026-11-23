import { describe, expect, it } from "vitest";
import { DIALECTS, type DbDialectClient } from "./dialect";
import { createDbToolsConnection } from "./dbTools";

function makeFakeClient(
  rows: Record<string, unknown>[] = [{ id: 1 }]
): DbDialectClient {
  return {
    query: async () => ({ rows, rowCount: rows.length }),
    close: async () => {},
  };
}

describe("createDbToolsConnection (原生 DB 工具装配)", () => {
  it("listTools 返回数据库标准三大工具元数据", async () => {
    const conn = createDbToolsConnection(
      DIALECTS.postgres,
      makeFakeClient(),
      "业务库"
    );
    const tools = await conn.listTools();

    expect(tools.map((t) => t.name)).toEqual([
      "list_tables",
      "describe_table",
      "execute_sql",
    ]);
  });

  it("callTool execute_sql 成功执行并返回 JSON 文本", async () => {
    const client = makeFakeClient([{ name: "alice", amount: 100 }]);
    const conn = createDbToolsConnection(DIALECTS.postgres, client, "业务库");

    const res = await conn.callTool("execute_sql", {
      sql: "SELECT * FROM users",
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].type).toBe("text");
    expect(JSON.parse(res.content[0].text)).toEqual({
      rowCount: 1,
      rows: [{ name: "alice", amount: 100 }],
    });
  });

  it("callTool 遇到异常时以 isError 格式化返回而不崩溃抛出", async () => {
    const client: DbDialectClient = {
      query: async () => {
        throw new Error("Table 'secret' does not exist");
      },
      close: async () => {},
    };
    const conn = createDbToolsConnection(DIALECTS.postgres, client, "业务库");

    const res = await conn.callTool("execute_sql", {
      sql: "SELECT * FROM secret",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Table 'secret' does not exist");
  });
});
