// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { PATCH, DELETE } from "./route";
import { datasources } from "@/lib/datasources";

vi.mock("@/lib/datasources", async () => {
  const { validateSourceConfig } = await import(
    "@ginkgo/datasources"
  );
  return {
    datasources: {
      validate: vi.fn(validateSourceConfig),
      get: vi.fn(() => undefined),
      upsert: vi.fn(),
      delete: vi.fn(),
      close: vi.fn(async () => {}),
      removeFiles: vi.fn(async () => {}),
    },
  };
});

const BASE = "http://localhost:3006/api/datasources";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_DB = {
  id: "mysql-1",
  name: "订单库",
  kind: "db" as const,
  dbType: "mysql" as const,
  connectionString: "mysql://user:pass@localhost:3306/db",
  enabled: true,
};

describe("PATCH /api/datasources/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("动态源更新 name 并回写", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_DB });

    const res = await PATCH(
      new Request(`${BASE}/mysql-1`, {
        method: "PATCH",
        body: JSON.stringify({ name: "订单库 v2" }),
      }),
      makeContext("mysql-1")
    );

    expect(res.status).toBe(200);
    expect(datasources.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mysql-1", name: "订单库 v2" })
    );
  });

  it("更新连接串并脱敏返回", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_DB });

    const res = await PATCH(
      new Request(`${BASE}/mysql-1`, {
        method: "PATCH",
        body: JSON.stringify({
          connectionString: "mysql://user:newPass@localhost:3306/db",
        }),
      }),
      makeContext("mysql-1")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source.maskedConnectionString).toContain("mysql://user:***@localhost:3306/db");
  });

  it("不存在的数据源返回 404", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(undefined);

    const res = await PATCH(
      new Request(`${BASE}/ghost`, { method: "PATCH", body: JSON.stringify({}) }),
      makeContext("ghost")
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/datasources/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("成功删除存在的数据源并释放连接", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_DB });

    const res = await DELETE(
      new Request(`${BASE}/mysql-1`, { method: "DELETE" }),
      makeContext("mysql-1")
    );

    expect(res.status).toBe(204);
    expect(datasources.delete).toHaveBeenCalledWith("mysql-1");
    expect(datasources.close).toHaveBeenCalledWith("mysql-1");
  });

  it("不存在的数据源返回 404", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(undefined);

    const res = await DELETE(
      new Request(`${BASE}/ghost`, { method: "DELETE" }),
      makeContext("ghost")
    );

    expect(res.status).toBe(404);
  });
});
