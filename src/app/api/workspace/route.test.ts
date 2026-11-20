import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { GET } from "./route";
import { resolveWorkspaceContext } from "@/lib/workspaceResolver";

describe("GET /api/workspace", () => {
  it("扫描工作区文件树列表", async () => {
    const ws = await resolveWorkspaceContext({
      appId: "general",
      sessionId: "test_ws_api",
    });
    // 写入一个测试文件
    await fs.writeFile(path.join(ws.sandboxDir, "hello.txt"), "world", "utf-8");

    const req = new Request("http://localhost/api/workspace?appId=general&sessionId=test_ws_api");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.appId).toBe("general");
    expect(data.sessionId).toBe("test_ws_api");
    expect(Array.isArray(data.files)).toBe(true);
    const hasHello = data.files.some((f: { name: string }) => f.name === "hello.txt");
    expect(hasHello).toBe(true);
  });

  it("读取指定文件内容", async () => {
    const ws = await resolveWorkspaceContext({
      appId: "general",
      sessionId: "test_ws_api",
    });
    await fs.writeFile(path.join(ws.sandboxDir, "code.ts"), "const x = 42;", "utf-8");

    const req = new Request(
      "http://localhost/api/workspace?appId=general&sessionId=test_ws_api&filePath=code.ts"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.path).toBe("code.ts");
    expect(data.content).toBe("const x = 42;");
  });

  it("阻止非法路径逃逸", async () => {
    const req = new Request(
      "http://localhost/api/workspace?appId=general&sessionId=test_ws_api&filePath=../../outside.txt"
    );
    const res = await GET(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("越权访问被阻止");
  });
});
