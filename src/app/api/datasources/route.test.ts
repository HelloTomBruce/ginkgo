// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { datasources } from "@/lib/datasources";

vi.mock("@/lib/datasources", async () => {
  const { validateSourceConfig } = await import(
    "@openui-analytics/datasources"
  );
  return {
    datasources: {
      validate: vi.fn(validateSourceConfig),
      list: vi.fn(() => [
        { id: "pg-a", name: "PostgreSQL 分析库", kind: "db", dbType: "postgres", tools: [], enabled: true },
        { id: "files-1", name: "离线销售数据", kind: "file", tools: [], enabled: true },
      ]),
      health: vi.fn(async () => ({ ok: true, latencyMs: 5 })),
      get: vi.fn(() => undefined),
      upsert: vi.fn(),
    },
  };
});

const BASE = "http://localhost:3006/api/datasources";

describe("GET /api/datasources", () => {
  beforeEach(() => {
    vi.mocked(datasources.get).mockImplementation((id: string) => ({
      id,
      name: id,
      kind: "db" as const,
      dbType: "postgres" as const,
      connectionString: "postgres://user@localhost/db",
      enabled: true,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(datasources.get).mockImplementation(() => undefined);
  });

  it("返回所有数据源与健康状态", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toHaveLength(2);
    expect(body.health["pg-a"].ok).toBe(true);
    expect(body.health["files-1"].ok).toBe(true);
  });

  it("动态源响应不泄露连接串密码", async () => {
    vi.mocked(datasources.list).mockReturnValueOnce([
      {
        id: "mysql-a",
        name: "订单库",
        kind: "db",
        tools: [],
        enabled: true,
        dbType: "mysql",
        maskedConnectionString: "mysql://u:***@h:3306/db",
      },
    ]);

    const res = await GET();
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain("p@h");
    expect(raw).toContain("mysql://u:***@h:3306/db");
  });
});

describe("POST /api/datasources", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("合法 db 源创建成功，连接串脱敏返回", async () => {
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({
          id: "mysql-a",
          name: "订单库",
          kind: "db",
          dbType: "mysql",
          connectionString: "mysql://u:secretPass@h:3306/db",
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toMatchObject({
      id: "mysql-a",
      dbType: "mysql",
      maskedConnectionString: "mysql://u:***@h:3306/db",
    });
    expect(JSON.stringify(body)).not.toContain("secretPass");
    expect(datasources.upsert).toHaveBeenCalledTimes(1);
  });

  it("重复 id 返回 409", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({
      id: "orders",
      name: "已有",
      kind: "db",
      dbType: "postgres",
      connectionString: "postgres://root@localhost/db",
      enabled: true,
    });

    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({
          id: "orders",
          name: "订单库",
          kind: "db",
          dbType: "postgres",
          connectionString: "postgres://root@localhost/db",
        }),
      })
    );

    expect(res.status).toBe(409);
    expect(datasources.upsert).not.toHaveBeenCalled();
  });

  it("非法配置返回 400 与错误列表", async () => {
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({ id: "BAD_ID", name: "", kind: "db" }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
  });
});
