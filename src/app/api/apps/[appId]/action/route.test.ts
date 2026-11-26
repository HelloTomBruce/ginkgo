// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const mockDispatchAction = vi.fn();

vi.mock("@/lib/apps/registry", () => ({
  appRegistry: {
    has: (id: string) => id === "test-app" || id === "design" || id === "disabled-app",
    // 启用态门禁：停用应用必须与「不存在」可区分（403 vs 404）
    isAppEnabled: (id: string) => id === "test-app" || id === "design",
  },
}));

vi.mock("@/lib/apps/runtimeServers", () => ({
  resolveRuntimeServer: (appId: string) => {
    if (appId === "test-app") {
      return { dispatchAction: mockDispatchAction };
    }
    return {};
  },
}));

vi.mock("@/lib/sessionStore", () => ({
  sessionStore: {
    get: vi.fn(async (id: string) => {
      if (id === "sess-valid") {
        return { id: "sess-valid", appId: "test-app" };
      }
      if (id === "sess-other-app") {
        return { id: "sess-other-app", appId: "other-app" };
      }
      return null;
    }),
  },
}));

vi.mock("@/lib/workspaceResolver", () => ({
  resolveWorkspaceForSession: vi.fn(async () => ({
    sandboxDir: "/tmp/mock-sandbox",
  })),
}));

describe("POST /api/apps/[appId]/action (App Action Gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("当 appId 不在注册表中时返回 404", async () => {
    const req = new Request("http://localhost/api/apps/unknown/action", {
      method: "POST",
      body: JSON.stringify({ action: "test", sessionId: "sess-valid" }),
    });
    const res = await POST(req, { params: Promise.resolve({ appId: "unknown" }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("App not found");
  });

  it("当应用已注册但被停用时返回 403（与 404 语义区分）", async () => {
    const req = new Request("http://localhost/api/apps/disabled-app/action", {
      method: "POST",
      body: JSON.stringify({ action: "test", sessionId: "sess-valid" }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ appId: "disabled-app" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("disabled");
  });

  it("当缺少 action 或 sessionId 时返回 400", async () => {
    const reqNoAction = new Request("http://localhost/api/apps/test-app/action", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-valid" }),
    });
    const res1 = await POST(reqNoAction, { params: Promise.resolve({ appId: "test-app" }) });
    expect(res1.status).toBe(400);

    const reqNoSession = new Request("http://localhost/api/apps/test-app/action", {
      method: "POST",
      body: JSON.stringify({ action: "ping" }),
    });
    const res2 = await POST(reqNoSession, { params: Promise.resolve({ appId: "test-app" }) });
    expect(res2.status).toBe(400);
  });

  it("当 session 不存在时返回 404", async () => {
    const req = new Request("http://localhost/api/apps/test-app/action", {
      method: "POST",
      body: JSON.stringify({ action: "ping", sessionId: "sess-non-existent" }),
    });
    const res = await POST(req, { params: Promise.resolve({ appId: "test-app" }) });
    expect(res.status).toBe(404);
  });

  it("当 session.appId 与请求路由不匹配时返回 403 越权拒绝", async () => {
    const req = new Request("http://localhost/api/apps/test-app/action", {
      method: "POST",
      body: JSON.stringify({ action: "ping", sessionId: "sess-other-app" }),
    });
    const res = await POST(req, { params: Promise.resolve({ appId: "test-app" }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("mismatch");
  });

  it("当应用未实现 dispatchAction 契约时返回 501", async () => {
    const req = new Request("http://localhost/api/apps/design/action", {
      method: "POST",
      body: JSON.stringify({ action: "ping", sessionId: "sess-valid" }),
    });
    // mock 会话为 design
    const { sessionStore } = await import("@/lib/sessionStore");
    vi.mocked(sessionStore.get).mockResolvedValueOnce({
      id: "sess-valid",
      appId: "design",
    } as unknown as { id: string; appId: string; title: string; createdAt: number; updatedAt: number; messages: [] });

    const res = await POST(req, { params: Promise.resolve({ appId: "design" }) });
    expect(res.status).toBe(501);
  });

  it("正常校验通过时委托 dispatchAction 执行并回包", async () => {
    mockDispatchAction.mockResolvedValueOnce({ success: true, count: 42 });

    const req = new Request("http://localhost/api/apps/test-app/action", {
      method: "POST",
      body: JSON.stringify({
        action: "compute",
        payload: { x: 10 },
        sessionId: "sess-valid",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ appId: "test-app" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(42);

    expect(mockDispatchAction).toHaveBeenCalledWith(
      "compute",
      { x: 10 },
      expect.objectContaining({
        appId: "test-app",
        sessionId: "sess-valid",
        workspaceDir: "/tmp/mock-sandbox",
      })
    );
  });
});
