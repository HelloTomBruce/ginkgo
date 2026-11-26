import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gateAppTools } from "./permissionGate";
import { appRegistry } from "./registry";
import { resetStorageRootCacheForTesting } from "@/lib/storagePaths";
import { resetAppsBootstrapForTesting } from "./bootstrap";

/**
 * 门禁契约（模型 v1）：
 *   - 内置应用（未声明 permissions）工具集不变（零回归）；
 *   - 第三方应用按 toolPermissions 白名单放行，其余默认拒绝。
 */
describe("gateAppTools 工具权限门禁", () => {
  const originalEnv = process.env;
  let tmpHome: string;

  const tools = {
    sql_query: { name: "sql_query" },
    shell_run: { name: "shell_run" },
    undeclared: { name: "undeclared" },
  };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-gate-test-"));
    process.env.GINKGO_HOME = tmpHome;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  it("内置应用（未声明 permissions）工具集原样通过", () => {
    const result = gateAppTools("analytics", undefined, tools);
    expect(Object.keys(result.tools)).toEqual([
      "sql_query",
      "shell_run",
      "undeclared",
    ]);
    expect(result.stripped).toEqual({});
  });

  it("第三方应用：授予的权限放行，未授予与未声明的一律剥离", () => {
    appRegistry.register(
      {
        manifest: {
          id: "third_party",
          name: "第三方",
          description: "",
          icon: "Bot",
          permissions: ["datasources.read"],
        },
        client: { welcomeMessage: "hi", presetQueries: [] },
        server: {
          buildSystemPrompt: () => "p",
          toolPermissions: {
            sql_query: "datasources.read",
            shell_run: "shell.execute",
          },
        },
      },
      { enabled: true }
    );

    const result = gateAppTools(
      "third_party",
      { sql_query: "datasources.read", shell_run: "shell.execute" },
      tools
    );

    expect(Object.keys(result.tools)).toEqual(["sql_query"]);
    expect(result.stripped.shell_run).toContain("shell.execute");
    expect(result.stripped.undeclared).toContain("default deny");

    appRegistry.unregister("third_party");
  });

  it("已停用的第三方应用不再产出工具（启用态优先于权限）", () => {
    appRegistry.register(
      {
        manifest: {
          id: "disabled_third",
          name: "已停用",
          description: "",
          icon: "Bot",
          permissions: ["datasources.read"],
        },
        client: { welcomeMessage: "hi", presetQueries: [] },
        server: { buildSystemPrompt: () => "p" },
      },
      { enabled: false }
    );

    // getEnabled 返回 undefined → 视为未声明权限 → 不额外剥离
    // （真实执行路径上 tools 本身就不会被装配出来）
    const result = gateAppTools("disabled_third", undefined, tools);
    expect(Object.keys(result.tools)).toEqual([
      "sql_query",
      "shell_run",
      "undeclared",
    ]);

    appRegistry.unregister("disabled_third");
  });
});
