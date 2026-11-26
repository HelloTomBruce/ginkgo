import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkAppHealth,
  clearHealthCheckCache,
} from "./capabilityNegotiator";
import { appRegistry } from "./registry";
import { resetStorageRootCacheForTesting } from "@/lib/storagePaths";
import { resetAppsBootstrapForTesting } from "./bootstrap";
import type { AppPackageDefinition } from "@ginkgo/app-sdk";

/**
 * 宿主零领域语义的硬约束：
 *   - 平台内置能力 → 宿主直接判定为就绪；
 *   - 外部能力（CLI 等）→ 只认应用自己的 healthCheck，**宿主编不出安装命令**；
 *   - 结果按 TTL 缓存，避免每次列表请求都探测外部命令。
 */
function makeApp(
  overrides: Partial<AppPackageDefinition["manifest"]> = {},
  server: Partial<AppPackageDefinition["server"]> = {}
): AppPackageDefinition {
  return {
    manifest: {
      id: "probe_app",
      name: "探测应用",
      description: "",
      icon: "Bot",
      ...overrides,
    },
    client: { welcomeMessage: "hi", presetQueries: [] },
    server: { buildSystemPrompt: () => "p", ...server },
  };
}

describe("checkAppHealth 能力协商（宿主零领域语义）", () => {
  const originalEnv = process.env;
  let tmpHome: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-health-test-"));
    process.env.GINKGO_HOME = tmpHome;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
    clearHealthCheckCache();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
    clearHealthCheckCache();
    vi.restoreAllMocks();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  it("只声明平台内置能力且无自定义探测 → ready", async () => {
    const result = await checkAppHealth(
      makeApp(
        { id: "platform_only" },
        { requiredCapabilities: ["sql_query", "chart_spec", "methodology"] }
      )
    );
    expect(result.status).toBe("ready");
    expect(result.healthy).toBe(true);
  });

  it("声明平台未提供的能力但没有 healthCheck → degraded 且只提示应用补探测", async () => {
    const result = await checkAppHealth(
      makeApp(
        { id: "external_no_hook" },
        { requiredCapabilities: ["some_external_cli" as never] }
      )
    );

    expect(result.status).toBe("degraded");
    expect(result.missingCapabilities).toContain("unverified:some_external_cli");
    // 红线：宿主编不出安装命令，只要求应用实现探测
    expect(result.remediationGuide).toContain("server.healthCheck");
    expect(result.remediationGuide).not.toContain("npm install -g");
  });

  it("应用声明 healthCheck 时以其结果为准（可返回 missing_deps + 修复指引）", async () => {
    const healthCheck = vi.fn().mockResolvedValue({
      healthy: false,
      status: "missing_deps",
      missingCapabilities: ["cli:lark-cli"],
      remediationGuide: "npm install -g lark-cli",
      message: "缺 CLI",
    });

    const result = await checkAppHealth(
      makeApp({ id: "with_hook" }, { healthCheck })
    );

    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("missing_deps");
    expect(result.missingCapabilities).toEqual(["cli:lark-cli"]);
  });

  it("healthCheck 抛错时降级为 degraded，不把异常抛给列表接口", async () => {
    const result = await checkAppHealth(
      makeApp(
        { id: "boom" },
        {
          healthCheck: async () => {
            throw new Error("probe crashed");
          },
        }
      )
    );

    expect(result.status).toBe("degraded");
    expect(result.message).toContain("probe crashed");
  });

  it("结果按 TTL 缓存：连续两次调用只探测一次", async () => {
    const healthCheck = vi.fn().mockResolvedValue({
      healthy: true,
      status: "ready",
    });
    const app = makeApp({ id: "cached" }, { healthCheck });

    await checkAppHealth(app);
    await checkAppHealth(app);

    expect(healthCheck).toHaveBeenCalledTimes(1);
  });

  it("清空缓存后重新探测", async () => {
    const healthCheck = vi.fn().mockResolvedValue({
      healthy: true,
      status: "ready",
    });
    const app = makeApp({ id: "cache_reset" }, { healthCheck });

    await checkAppHealth(app);
    clearHealthCheckCache();
    await checkAppHealth(app);

    expect(healthCheck).toHaveBeenCalledTimes(2);
  });

  it("内置应用 design 走组合根注入的 healthCheck（远端 CLI 缺失 → missing_deps）", async () => {
    // 仅在注册表已按默认配置引导时有效；此处直接验证 registry 中的 design 存在
    const design = appRegistry.get("design");
    expect(design).toBeDefined();

    const result = await checkAppHealth(design!);
    // 结果取决于本机是否安装 claude-design —— 只断言形态，不断言具体值
    expect(["ready", "missing_deps", "degraded"]).toContain(result.status);
    if (result.status === "missing_deps") {
      expect(result.missingCapabilities?.some((c) => c.startsWith("cli:"))).toBe(
        true
      );
      expect(result.remediationGuide).toContain("npm install -g");
    }
  });
});
