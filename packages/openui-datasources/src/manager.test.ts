import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DIALECTS } from "./connectors/db/dialect";
import { createDatasourceManager } from "./manager";

vi.mock("./connectors/db/dialect", () => ({
  DIALECTS: {
    postgres: {
      connect: vi.fn(),
      ping: vi.fn(),
      listTables: vi.fn(async () => ["users", "orders"]),
      describeTable: vi.fn(async () => [
        { name: "id", type: "integer" },
        { name: "amount", type: "numeric" },
      ]),
      readOnlyQuery: vi.fn(async () => ({ rowCount: 1, rows: [{ id: 1, amount: 99 }] })),
      dbType: "postgres",
    },
    mysql: {
      connect: vi.fn(),
      ping: vi.fn(),
      listTables: vi.fn(async () => ["t_order"]),
      describeTable: vi.fn(async () => [{ name: "id", type: "int" }]),
      readOnlyQuery: vi.fn(async () => ({ rowCount: 1, rows: [{ id: 1 }] })),
      dbType: "mysql",
    },
  },
}));

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "dynsources-")),
    "datasources.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

function managerFor(content: string) {
  const file = writeTempConfig(content);
  return createDatasourceManager({ configPath: file });
}

const DB_SOURCE = {
  id: "m1",
  name: "订单库",
  kind: "db" as const,
  dbType: "mysql" as const,
  connectionString: "mysql://u:p@h:3306/orders",
  enabled: true,
};

describe("DatasourceManager (纯化数据源管理)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list 返回已配置的数据源描述符，密码正确脱敏", () => {
    const m = managerFor(JSON.stringify({ sources: [DB_SOURCE] }));
    const list = m.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("m1");
    expect(list[0].kind).toBe("db");
    expect(list[0].maskedConnectionString).toBe("mysql://u:***@h:3306/orders");
    expect(list[0].tools).toEqual(["execute_sql", "list_tables", "describe_table"]);
  });

  it("tools 成功装配带前缀的工具绑定集，call 直接执行对应操作", async () => {
    const fakeClient = {
      query: vi.fn(async () => ({ rowCount: 1, rows: [{ id: 1 }] })),
      close: vi.fn(async () => {}),
    };
    vi.mocked(DIALECTS.mysql.connect).mockResolvedValueOnce(fakeClient as never);

    const m = managerFor(JSON.stringify({ sources: [DB_SOURCE] }));
    const bindings = await m.tools(DB_SOURCE);

    expect(bindings.map((b) => b.name)).toEqual([
      "m1_list_tables",
      "m1_describe_table",
      "m1_execute_sql",
    ]);

    const res = await bindings[0].call({});
    expect(res).toEqual(["t_order"]);
  });

  it("close 正常释放连接并清理缓存", async () => {
    const fakeClient = {
      query: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(DIALECTS.mysql.connect).mockResolvedValueOnce(fakeClient as never);

    const m = managerFor(JSON.stringify({ sources: [DB_SOURCE] }));
    await m.connect(DB_SOURCE);
    await m.close("m1");

    expect(fakeClient.close).toHaveBeenCalledTimes(1);
  });

  it("health 检测正常执行探针", async () => {
    const fakeClient = {
      query: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(DIALECTS.mysql.connect).mockResolvedValueOnce(fakeClient as never);

    const m = managerFor(JSON.stringify({ sources: [DB_SOURCE] }));
    const h = await m.health(DB_SOURCE);

    expect(h.ok).toBe(true);
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
