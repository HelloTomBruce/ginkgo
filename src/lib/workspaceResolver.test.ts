import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveWorkspaceContext, resolveSafeWorkspacePath } from "./workspaceResolver";

describe("workspaceResolver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openui-ws-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("正确生成沙箱目录并确保物理目录存在", async () => {
    const ws = await resolveWorkspaceContext({
      appId: "general",
      sessionId: "sess_123",
      baseDir: tempDir,
    });
    expect(ws.appId).toBe("general");
    expect(ws.sessionId).toBe("sess_123");
    expect(ws.sandboxDir).toBe(path.join(tempDir, "general", "sess_123"));

    const stat = await fs.stat(ws.sandboxDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("支持自定义本地工作区路径", async () => {
    const custom = path.join(tempDir, "my-custom-project");
    const ws = await resolveWorkspaceContext({
      appId: "general",
      customRootDir: custom,
    });
    expect(ws.sandboxDir).toBe(custom);
    const stat = await fs.stat(custom);
    expect(stat.isDirectory()).toBe(true);
  });

  describe("resolveSafeWorkspacePath", () => {
    it("正常相对路径解析至工作区绝对路径", () => {
      const root = path.join(tempDir, "root");
      const safe = resolveSafeWorkspacePath(root, "src/index.ts");
      expect(safe).toBe(path.join(root, "src", "index.ts"));
    });

    it("阻止跨越上级的路径穿越攻击 (../)", () => {
      const root = path.join(tempDir, "root");
      expect(() => resolveSafeWorkspacePath(root, "../outside.txt")).toThrow("越权访问被阻止");
      expect(() => resolveSafeWorkspacePath(root, "../../etc/passwd")).toThrow("越权访问被阻止");
    });
  });
});
