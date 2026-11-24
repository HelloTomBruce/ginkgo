// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { GET, POST } from "./route";
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
    expect(data.error).toContain("越权访问被拒绝");
  });

  it("自动过滤 node_modules、.next、dist 等目录", async () => {
    const ws = await resolveWorkspaceContext({
      appId: "general",
      sessionId: "test_ws_api",
    });
    // 创建 node_modules 和 dist 文件夹及内部文件
    const nmDir = path.join(ws.sandboxDir, "node_modules", "some-pkg");
    await fs.mkdir(nmDir, { recursive: true });
    await fs.writeFile(path.join(nmDir, "index.js"), "module.exports = {};", "utf-8");

    const distDir = path.join(ws.sandboxDir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "bundle.js"), "console.log(1);", "utf-8");

    const req = new Request("http://localhost/api/workspace?appId=general&sessionId=test_ws_api");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    const filePaths = data.files.map((f: { path: string }) => f.path);
    // 确保没有 node_modules 和 dist 及其内部文件
    expect(filePaths.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(filePaths.some((p: string) => p.includes("dist"))).toBe(false);
  });

  it("对二进制文件返回预览占位，避免 utf-8 乱码", async () => {
    const req = new Request(
      "http://localhost/api/workspace?appId=general&sessionId=test_ws_api&filePath=icon.png"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isBinary).toBe(true);
    expect(data.content).toContain("二进制文件");
  });

  it("action=git_status 查询工作区 Git 状态", async () => {
    const req = new Request(
      "http://localhost/api/workspace?appId=general&sessionId=test_ws_api&action=git_status"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.isGitRepo).toBe("boolean");
    expect(Array.isArray(data.changes)).toBe(true);
  });

  it("POST /api/workspace 在沙箱执行轻量终端命令", async () => {
    const req = new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: "general",
        sessionId: "test_ws_api",
        command: "echo 'hello terminal'",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.stdout).toContain("hello terminal");
    expect(data.exitCode).toBe(0);
  });
});
