import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliBridge, resolveBinExecutable } from "./cliBridge";

/**
 * 不依赖本仓 node_modules 的具体内容（旧用例断言 vite 被 hoist 到根目录，
 * pnpm 结构一变就红）。改为在临时目录里构造 node_modules/.bin 现场。
 */
describe("CliBridge 本地 bin 寻址与降级防护", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-clibridge-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function makeFakeBin(dir: string, name: string): Promise<string> {
    const binDir = path.join(dir, "node_modules", ".bin");
    await fs.mkdir(binDir, { recursive: true });
    const binPath = path.join(binDir, name);
    await fs.writeFile(binPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return binPath;
  }

  it("优先解析指定工作目录下的 node_modules/.bin", async () => {
    const expected = await makeFakeBin(tmpDir, "demo-tool");
    expect(resolveBinExecutable("demo-tool", tmpDir)).toBe(expected);
  });

  it("命令完全不存在时回退为裸命令名（交给 PATH）", () => {
    expect(resolveBinExecutable("non_existent_tool_12345")).toBe(
      "non_existent_tool_12345"
    );
  });

  it("指定目录无该 bin 时不会误报命中", async () => {
    await makeFakeBin(tmpDir, "another-tool");
    expect(resolveBinExecutable("demo-tool", tmpDir)).not.toContain(tmpDir);
  });

  it("执行不存在的命令触发 ENOENT 时，返回自愈指引而不是崩溃（退出码 127）", async () => {
    const res = await CliBridge.runCommand("completely_fake_cli_xyz_999", [
      "--version",
    ]);
    expect(res.code).toBe(127);
    expect(res.stderr).toContain("[依赖缺失]");
    expect(res.stderr).toContain("completely_fake_cli_xyz_999");
    expect(res.stderr).toContain("npm install -g");
  });
});
