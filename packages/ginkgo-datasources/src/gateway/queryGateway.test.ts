import { describe, it, expect, vi } from "vitest";
import { QueryGateway, McpGateway } from "./queryGateway";
import type { DatasourceManager } from "../manager";

describe("QueryGateway 核心功能测试", () => {
  it("保持 McpGateway 别名向后兼容", () => {
    expect(McpGateway).toBe(QueryGateway);
  });

  it("只读校验：拦截非只读 SQL", async () => {
    const mockManager = {
      get: vi.fn().mockReturnValue({ id: "pg_main", enabled: true }),
      tools: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockReturnValue([]),
    } as unknown as DatasourceManager;

    const gateway = new QueryGateway(mockManager);

    await expect(
      gateway.executeQuery({
        sourceId: "pg_main",
        sql: "DROP TABLE users",
      })
    ).rejects.toThrow(/安全限制/);
  });

  it("正常执行与缓存命中机制", async () => {
    // 网关经原始连接直发（绕过 tools 绑定守卫），返回工具协议形态结果
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

    const gateway = new QueryGateway(mockManager);

    // 第一次调用：未命中缓存
    const res1 = await gateway.executeQuery({
      sourceId: "pg_main",
      sql: "SELECT * FROM users",
    });

    expect(res1.rowCount).toBe(1);
    expect(res1.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(res1.cacheHit).toBe(false);
    expect(mockRawCall).toHaveBeenCalledTimes(1);

    // 第二次调用：命中缓存
    const res2 = await gateway.executeQuery({
      sourceId: "pg_main",
      sql: "SELECT * FROM users",
    });

    expect(res2.rowCount).toBe(1);
    expect(res2.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(res2.cacheHit).toBe(true);
    expect(mockRawCall).toHaveBeenCalledTimes(1); // 未发起底层调用
  });

  it("两阶段发现第一阶段：listCatalogs 返回表名概览", async () => {
    const mockManager = {
      list: vi.fn().mockReturnValue([
        { id: "pg_orders", name: "Orders DB", kind: "db", dbType: "postgres" },
      ]),
      get: vi.fn().mockReturnValue({ id: "pg_orders", enabled: true }),
      tools: vi.fn().mockResolvedValue([
        {
          name: "pg_orders_list_tables",
          originalName: "list_tables",
          call: vi.fn().mockResolvedValue({ tables: ["orders", "items"] }),
        },
      ]),
    } as unknown as DatasourceManager;

    const gateway = new QueryGateway(mockManager);
    const catalogs = await gateway.listCatalogs();

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].sourceId).toBe("pg_orders");
    expect(catalogs[0].tables).toEqual(["orders", "items"]);
  });

  it("两阶段发现第二阶段：describeTableResource 拦截非法表名注入", async () => {
    const mockManager = {} as unknown as DatasourceManager;
    const gateway = new QueryGateway(mockManager);

    await expect(
      gateway.describeTableResource("pg_orders", "orders; DROP TABLE users;--")
    ).rejects.toThrow(/非法表名/);
  });

  it("两阶段发现第二阶段：按白名单表名获取字段与样本行", async () => {
    const mockManager = {
      get: vi.fn().mockReturnValue({ id: "pg_orders", enabled: true }),
      tools: vi.fn().mockResolvedValue([
        {
          name: "pg_orders_describe_table",
          originalName: "describe_table",
          call: vi.fn().mockResolvedValue({
            columns: [
              { column: "id", type: "int" },
              { column: "total", type: "decimal", comment: "总金额" },
            ],
          }),
        },
        {
          name: "pg_orders_execute_sql",
          originalName: "execute_sql",
          call: vi.fn(),
        },
      ]),
      connect: vi.fn().mockResolvedValue({
        callTool: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify([{ id: 1, total: 99.9 }]),
            },
          ],
        }),
      }),
    } as unknown as DatasourceManager;

    const gateway = new QueryGateway(mockManager);
    const detail = await gateway.describeTableResource("pg_orders", "orders");

    expect(detail.tableName).toBe("orders");
    expect(detail.columns).toHaveLength(2);
    expect(detail.columns[1].name).toBe("total");
    expect(detail.columns[1].comment).toBe("总金额");
    expect(detail.sampleRows).toEqual([{ id: 1, total: 99.9 }]);
  });
});
