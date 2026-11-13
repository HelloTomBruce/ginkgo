// @vitest-environment node
// 依赖链经 @openui-analytics/datasources 触达 node:sqlite；Node 22 的
// builtinModules 未列 sqlite，jsdom（vite client 环境）无法外置会打包失败
import { describe, it, expect, vi, afterEach } from "vitest";
import { PATCH, DELETE } from "./route";
import { datasources } from "@/lib/datasources";

// 接缝 mock：纯函数（validate/describe）走真实包实现，IO（读写配置/关连接）走 mock
vi.mock("@/lib/datasources", async () => {
  const { validateSourceConfig } = await import(
    "@openui-analytics/datasources"
  );
  return {
    datasources: {
      validate: vi.fn(validateSourceConfig),
      get: vi.fn(() => undefined),
      upsert: vi.fn(),
      delete: vi.fn(),
      close: vi.fn(async () => {}),
    },
  };
});

const BASE = "http://localhost:3006/api/datasources";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_HTTP = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "glpat-old",
  enabled: true,
};

describe("PATCH /api/datasources/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("动态源更新 name 并回写", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    const res = await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Jira MCP 2" }),
      }),
      makeContext("jira")
    );

    expect(res.status).toBe(200);
    expect(datasources.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "jira", name: "Jira MCP 2" })
    );
  });

  it("token 不传时保留旧值", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      makeContext("jira")
    );

    expect(datasources.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ token: "glpat-old", enabled: false })
    );
  });

  it("显式传空 token 清空凭证", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ token: "" }),
      }),
      makeContext("jira")
    );

    expect(datasources.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ token: "" })
    );
  });

  it("内置源特例已移除：任意源 PATCH command 字段 200", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({
      id: "zc",
      name: "禅道",
      kind: "stdio-cli",
      command: "zentao",
      args: ["mcp", "--read-only"],
      enabled: true,
    });

    const res = await PATCH(
      new Request(`${BASE}/zc`, {
        method: "PATCH",
        body: JSON.stringify({ command: "zentao2" }),
      }),
      makeContext("zc")
    );
    expect(res.status).toBe(200);
    expect(datasources.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ command: "zentao2", kind: "stdio-cli" })
    );
  });

  it("更新成功后关闭旧连接以触发重建", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ url: "http://10.0.0.2:6000/mcp" }),
      }),
      makeContext("jira")
    );

    expect(datasources.close).toHaveBeenCalledWith("jira");
  });

  it("不存在的源返回 404", async () => {
    const res = await PATCH(
      new Request(`${BASE}/nope`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
      makeContext("nope")
    );
    expect(res.status).toBe(404);
  });

  it("拒绝值为脱敏占位符 *** 的 headers/params（防凭证被占位值覆盖）", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    const res = await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ headers: { Authorization: "***", "X-Env": "prod" } }),
      }),
      makeContext("jira")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("脱敏占位值");
    expect(datasources.upsert).not.toHaveBeenCalled();

    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });
    const res2 = await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ params: { api_key: "***" } }),
      }),
      makeContext("jira")
    );
    expect(res2.status).toBe(400);
    expect(datasources.upsert).not.toHaveBeenCalled();
  });

  it("正常 headers 更新不受影响", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    const res = await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ headers: { Authorization: "Bearer real-token" } }),
      }),
      makeContext("jira")
    );
    expect(res.status).toBe(200);
    expect(datasources.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer real-token" },
      })
    );
  });
});

describe("DELETE /api/datasources/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("删除动态源并关闭其连接", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...EXISTING_HTTP });

    const res = await DELETE(
      new Request(`${BASE}/jira`, { method: "DELETE" }),
      makeContext("jira")
    );

    expect(res.status).toBe(204);
    expect(datasources.delete).toHaveBeenCalledWith("jira");
    expect(datasources.close).toHaveBeenCalledWith("jira");
  });

  it("不存在的源返回 404", async () => {
    const res = await DELETE(
      new Request(`${BASE}/nope`, { method: "DELETE" }),
      makeContext("nope")
    );
    expect(res.status).toBe(404);
    expect(datasources.delete).not.toHaveBeenCalled();
  });
});
