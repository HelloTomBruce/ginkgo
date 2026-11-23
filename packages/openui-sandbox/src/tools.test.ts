import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSandboxTools, assertSafePath } from "./tools";
import { sandboxToolsPromptSection } from "./prompt";

describe("createSandboxTools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openui-sandbox-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("assertSafePath 拒绝目录逃逸", () => {
    expect(() => assertSafePath(tempDir, "../escape.txt")).toThrow("越权访问被拒绝");
    expect(() => assertSafePath(tempDir, "../../etc/passwd")).toThrow("越权访问被拒绝");
    expect(assertSafePath(tempDir, "src/index.ts")).toBe(path.join(tempDir, "src", "index.ts"));
  });

  it("atomic 预设只含 4 把原子工具；explorer 追加只读 list_dir", () => {
    const atomic = createSandboxTools({ sandboxDir: tempDir });
    expect(Object.keys(atomic).sort()).toEqual([
      "edit_file",
      "read_file",
      "run_command",
      "write_file",
    ]);

    const explorer = createSandboxTools({ sandboxDir: tempDir, preset: "explorer" });
    expect(Object.keys(explorer).sort()).toEqual([
      "edit_file",
      "list_dir",
      "read_file",
      "run_command",
      "write_file",
    ]);
  });

  it("write_file / read_file 写入并读取文本，支持行切片", async () => {
    const tools = createSandboxTools({ sandboxDir: tempDir });

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
    const tools = createSandboxTools({ sandboxDir: tempDir });

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
    const tools = createSandboxTools({ sandboxDir: tempDir });

    const res = await tools.run_command.execute!(
      { command: "rm -rf /" },
      {} as never
    );
    expect(res).toHaveProperty("error");
    expect((res as { error: string }).error).toContain("安全策略拦截");
  });

  it("run_command 在沙箱目录下执行安全命令", async () => {
    const tools = createSandboxTools({ sandboxDir: tempDir });

    const res = await tools.run_command.execute!(
      { command: "echo 'hello sandbox'" },
      {} as never
    );
    expect(res).toHaveProperty("success", true);
    expect((res as { stdout: string }).stdout).toBe("hello sandbox");
  });

  it("explorer 预设 list_dir 递归遍历并忽略构建产物", async () => {
    const tools = createSandboxTools({ sandboxDir: tempDir, preset: "explorer" });

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

  it("prompt 片段随 preset 变化：atomic 不提 list_dir，explorer 提及", () => {
    const atomic = sandboxToolsPromptSection("atomic");
    expect(atomic).not.toContain("list_dir");
    expect(atomic).toContain("run_command");

    const explorer = sandboxToolsPromptSection("explorer");
    expect(explorer).toContain("list_dir");
  });

  it("readonly 权限档：只装配只读工具（写/shell 不出现），四组合断言", () => {
    expect(Object.keys(createSandboxTools({ sandboxDir: tempDir })).sort()).toEqual([
      "edit_file",
      "read_file",
      "run_command",
      "write_file",
    ]);
    expect(
      Object.keys(
        createSandboxTools({ sandboxDir: tempDir, permission: "full", preset: "explorer" })
      ).sort()
    ).toEqual(["edit_file", "list_dir", "read_file", "run_command", "write_file"]);
    expect(
      Object.keys(createSandboxTools({ sandboxDir: tempDir, permission: "readonly" })).sort()
    ).toEqual(["read_file"]);
    expect(
      Object.keys(
        createSandboxTools({ sandboxDir: tempDir, permission: "readonly", preset: "explorer" })
      ).sort()
    ).toEqual(["list_dir", "read_file"]);
  });

  it("readonly 的 prompt 段说明只读边界与解锁路径", () => {
    const section = sandboxToolsPromptSection("atomic", "readonly");
    expect(section).toContain("只读");
    expect(section).toContain("read_file");
    expect(section).toContain("解锁");
    // 只读段不宣称写入/命令能力
    expect(section).not.toContain("write_file");
    expect(section).not.toContain("run_command");
  });

  it("run_command 环境变量白名单：敏感变量不进入子进程，env 注入位显式放行", async () => {
    // 植入一个白名单外的敏感变量，验证子进程读不到
    process.env.SANDBOX_TEST_SECRET = "leak-me";
    try {
      const leakTools = createSandboxTools({ sandboxDir: tempDir });
      const leakRes = await leakTools.run_command.execute!(
        { command: 'node -e "console.log(process.env.SANDBOX_TEST_SECRET ?? \'FILTERED\')"' },
        {} as never
      );
      expect((leakRes as { stdout: string }).stdout).toBe("FILTERED");

      // env 注入位显式放行的变量可达
      const allowTools = createSandboxTools({
        sandboxDir: tempDir,
        env: { SANDBOX_TEST_SECRET: "allowed" },
      });
      const allowRes = await allowTools.run_command.execute!(
        { command: 'node -e "console.log(process.env.SANDBOX_TEST_SECRET)"' },
        {} as never
      );
      expect((allowRes as { stdout: string }).stdout).toBe("allowed");
    } finally {
      delete process.env.SANDBOX_TEST_SECRET;
    }
  });
});
