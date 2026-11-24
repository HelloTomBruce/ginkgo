import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";

let mockWorkspaces: Array<{
  id: string;
  appId: string;
  name: string;
  path?: string;
  createdAt: number;
  updatedAt: number;
}> = [];

vi.mock("@/lib/workspaceStore", () => ({
  workspaceStore: {
    list: vi.fn().mockImplementation(async (appId?: string) => {
      if (!appId) return [...mockWorkspaces];
      return mockWorkspaces.filter(
        (w) => w.appId === appId || w.id === "ws_default"
      );
    }),
    create: vi.fn().mockImplementation(async (data: { name: string; path?: string; appId: string }) => {
      const record = {
        id: `ws_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: data.name,
        path: data.path,
        appId: data.appId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockWorkspaces.push(record);
      return record;
    }),
    remove: vi.fn().mockImplementation(async (id: string) => {
      const idx = mockWorkspaces.findIndex((w) => w.id === id);
      if (idx === -1) return false;
      mockWorkspaces.splice(idx, 1);
      return true;
    }),
  },
}));

describe("Workspaces API", () => {
  beforeEach(() => {
    mockWorkspaces = [
      {
        id: "ws_default",
        appId: "general",
        name: "默认工作区",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];
  });

  it("GET 列出工作区", async () => {
    const req = new Request("http://localhost/api/workspaces?appId=general");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.workspaces)).toBe(true);
    expect(data.workspaces.length).toBeGreaterThan(0);
  });

  it("POST 创建新工作区", async () => {
    const req = new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-workspace-api",
        appId: "general",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.workspace.name).toBe("test-workspace-api");
  });

  it("DELETE 不允许删除默认工作区", async () => {
    const req = new Request("http://localhost/api/workspaces?id=ws_default", {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("默认工作区不可删除");
  });

  it("DELETE 成功删除自定义工作区", async () => {
    // 先创建一个
    const createReq = new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "to-delete-ws",
        appId: "general",
      }),
    });
    const createRes = await POST(createReq);
    const { workspace } = await createRes.json();

    const deleteReq = new Request(`http://localhost/api/workspaces?id=${workspace.id}`, {
      method: "DELETE",
    });
    const deleteRes = await DELETE(deleteReq);
    expect(deleteRes.status).toBe(200);
    const data = await deleteRes.json();
    expect(data.success).toBe(true);
  });
});
