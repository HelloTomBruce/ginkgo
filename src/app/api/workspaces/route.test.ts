import { describe, it, expect } from "vitest";
import { GET, POST, DELETE } from "./route";

describe("Workspaces API", () => {
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
