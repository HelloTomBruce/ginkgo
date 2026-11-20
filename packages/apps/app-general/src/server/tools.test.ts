import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getGeneralTools, assertSafePath } from "./tools";

describe("getGeneralTools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openui-general-tools-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("assertSafePath 拒绝目录逃逸", () => {
    expect(() => assertSafePath(tempDir, "../escape.txt")).toThrow("越权访问被拒绝");
    expect(() => assertSafePath(tempDir, "../../etc/passwd")).toThrow("越权访问被拒绝");
    expect(assertSafePath(tempDir, "src/index.ts")).toBe(path.join(tempDir, "src", "index.ts"));
  });

  it("write_file / read_file 写入并读取文本，支持行切片", async () => {
    const tools = getGeneralTools({
      workspace: {
        appId: "general",
        sessionId: "test",
        sandboxDir: tempDir,
      },
    });

    // 1. 写入多行文件
    const content = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"].join("\n");
    const writeRes = await tools.write_file.execute!(
      { path: "docs/readme.md", content },
      {} as never
    );
    expect(writeRes).toHaveProperty("success", true);

    // 2. 切片读取第 2 到 4 行
    const readRes = await tools.read_file.execute!(
      { path: "docs/readme.md", startLine: 2, endLine: 4 },
      {} as never
    );
    expect(readRes).toMatchObject({
      startLine: 2,
      endLine: 4,
      totalLines: 5,
      content: ["Line 2", "Line 3", "Line 4"].join("\n"),
    });
  });

  it("edit_file 精准替换文本片段", async () => {
    const tools = getGeneralTools({
      workspace: {
        appId: "general",
        sandboxDir: tempDir,
      },
    });

    await tools.write_file.execute!(
      { path: "config.json", content: '{"env": "development", "debug": true}' },
      {} as never
    );

    const editRes = await tools.edit_file.execute!(
      {
        path: "config.json",
        target: '"env": "development"',
        replacement: '"env": "production"',
      },
      {} as never
    );
    expect(editRes).toHaveProperty("success", true);

    const readRes = await tools.read_file.execute!({ path: "config.json" }, {} as never);
    expect((readRes as { content: string }).content).toBe('{"env": "production", "debug": true}');
  });

  it("run_command 安全策略拦截高危破坏指令", async () => {
    const tools = getGeneralTools({
      workspace: { appId: "general", sandboxDir: tempDir },
    });

    const res = await tools.run_command.execute!(
      { command: "rm -rf /" },
      {} as never
    );
    expect(res).toHaveProperty("error");
    expect((res as { error: string }).error).toContain("安全策略拦截");
  });

  it("run_command 在沙箱目录下执行安全命令", async () => {
    const tools = getGeneralTools({
      workspace: { appId: "general", sandboxDir: tempDir },
    });

    const res = await tools.run_command.execute!(
      { command: "echo 'hello openui'" },
      {} as never
    );
    expect(res).toHaveProperty("success", true);
    expect((res as { stdout: string }).stdout).toBe("hello openui");
  });

  it("list_dir 递归遍历目录并忽略隐藏和构建产物", async () => {
    const tools = getGeneralTools({
      workspace: { appId: "general", sandboxDir: tempDir },
    });

    await tools.write_file.execute!(
      { path: "src/a.ts", content: "const a = 1;" },
      {} as never
    );
    await tools.write_file.execute!(
      { path: "node_modules/fake.js", content: "skip" },
      {} as never
    );

    const listRes = await tools.list_dir.execute!({ path: "", depth: 3 }, {} as never);
    expect(listRes).toHaveProperty("entries");
    const names = (listRes as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
    expect(names).toContain("src");
    expect(names).toContain("a.ts");
    expect(names).not.toContain("node_modules");
  });
});
