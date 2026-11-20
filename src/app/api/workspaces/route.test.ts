import { describe, it, expect } from "vitest";
import { GET, POST } from "./route";

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
});
