import { describe, it, expect, vi } from "vitest";
import { McpGateway } from "./mcpGateway";
import type { DatasourceManager } from "../manager";

describe("McpGateway 核心功能测试", () => {
  it("只读校验：拦截非只读 SQL", async () => {
    const mockManager = {
      get: vi.fn().mockReturnValue({ id: "pg_main", enabled: true }),
      tools: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockReturnValue([]),
    } as unknown as DatasourceManager;

    const gateway = new McpGateway(mockManager);

    await expect(
      gateway.executeQuery({
        sourceId: "pg_main",
        sql: "DROP TABLE users",
      })
    ).rejects.toThrow(/安全限制/);
  });

  it("正常执行与缓存命中机制", async () => {
    // 网关经原始连接直发（绕过 tools 绑定守卫），返回 MCP 协议形态结果
    const mockRawCall = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({ rows: [{ id: 1, name: "Alice" }], rowCount: 1 }),
        },
      ],
    });

    const mockManager = {
      get: vi.fn().mockReturnValue({ id: "pg_main", enabled: true }),
      connect: vi.fn().mockResolvedValue({ callTool: mockRawCall }),
      tools: vi.fn().mockResolvedValue([
        {
          name: "pg_main_execute_sql",
          originalName: "execute_sql",
          call: vi.fn(),
        },
      ]),
      list: vi.fn().mockReturnValue([]),
    } as unknown as DatasourceManager;

    const gateway = new McpGateway(mockManager);

    // 第一次调用：未命中缓存
    const res1 = await gateway.executeQuery({
      sourceId: "pg_main",
      sql: "SELECT * FROM users WHERE id = 1",
      bypassExplain: true,
    });

    expect(res1.cacheHit).toBe(false);
    expect(res1.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(mockRawCall).toHaveBeenCalledTimes(1);
    expect(mockRawCall).toHaveBeenCalledWith("execute_sql", {
      sql: "SELECT * FROM users WHERE id = 1",
    });

    // 第二次调用（相同查询）：命中结果集缓存
    const res2 = await gateway.executeQuery({
      sourceId: "pg_main",
      sql: "SELECT   * FROM   users WHERE id = 1", // 带多余空格测试归一化
      bypassExplain: true,
    });

    expect(res2.cacheHit).toBe(true);
    expect(res2.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(mockRawCall).toHaveBeenCalledTimes(1); // 没有向底层发起第二次查询！
  });

  it("字面量大小写敏感的查询绝不共享缓存", async () => {
    const mockRawCall = vi.fn().mockImplementation(async (_name, args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ rows: [{ v: (args as { sql: string }).sql }], rowCount: 1 }),
        },
      ],
    }));
    const mockManager = {
      get: vi.fn().mockReturnValue({ id: "pg_main", enabled: true }),
      connect: vi.fn().mockResolvedValue({ callTool: mockRawCall }),
      tools: vi.fn().mockResolvedValue([
        { name: "pg_main_execute_sql", originalName: "execute_sql", call: vi.fn() },
      ]),
      list: vi.fn().mockReturnValue([]),
    } as unknown as DatasourceManager;

    const gateway = new McpGateway(mockManager);
    const r1 = await gateway.executeQuery({
      sourceId: "pg_main",
      sql: "SELECT * FROM users WHERE name = 'ABC'",
      bypassExplain: true,
    });
    const r2 = await gateway.executeQuery({
      sourceId: "pg_main",
      sql: "select * from users where name = 'abc'",
      bypassExplain: true,
    });
    // 结构大小写归一化但字面量保留：两次都必须真实执行
    expect(r2.cacheHit).toBe(false);
    expect(mockRawCall).toHaveBeenCalledTimes(2);
    expect(r1.rows).not.toEqual(r2.rows);
  });

  it("两阶段发现第一阶段：listCatalogs 返回表名概览", async () => {
    const mockManager = {
      list: vi.fn().mockReturnValue([
        { id: "ds_pg", name: "业务主库", type: "postgres", enabled: true },
      ]),
      get: vi.fn().mockReturnValue({ id: "ds_pg", enabled: true }),
      tools: vi.fn().mockResolvedValue([
        {
          name: "ds_pg_list_tables",
          originalName: "list_tables",
          call: vi.fn().mockResolvedValue({
            tables: [{ table: "users" }, { table: "orders" }],
          }),
        },
      ]),
    } as unknown as DatasourceManager;

    const gateway = new McpGateway(mockManager);
    const catalogs = await gateway.listCatalogs();

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].sourceId).toBe("ds_pg");
    expect(catalogs[0].tables).toEqual(["users", "orders"]);
  });
});
