import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bootstrapApps,
  getAppLoadFailure,
  getAppsBootstrapReport,
  resetAppsBootstrapForTesting,
} from "./bootstrap";
import { appRegistry } from "./registry";
import { saveAppsConfig } from "./appConfigServer";
import { AppPackageManager } from "./packageManager";
import { resetStorageRootCacheForTesting } from "@/lib/storagePaths";

/**
 * 启动引导的核心承诺（对应 R1 / R3）：
 *   1. 磁盘配置是唯一事实来源——引导后注册表与之对齐；
 *   2. 已安装的第三方应用重启后重新注册（安装不等于一次性有效）；
 *   3. 单个应用载入失败不阻断引导，失败原因可被查询；
 *   4. 幂等单飞（dev 热重载 / 多入口调用不会重复注册）。
 */
const FAKE_APP_SOURCE = `
export default {
  manifest: {
    id: "demo",
    name: "演示插件",
    version: "1.0.0",
    description: "启动引导测试用",
    icon: "Bot",
  },
  client: { welcomeMessage: "hi", presetQueries: [] },
  server: { buildSystemPrompt: () => "demo prompt" },
};
`;

describe("应用启动引导 bootstrapApps", () => {
  const originalEnv = process.env;
  let tmpHome: string;

  async function writeConfig(apps: Array<Record<string, unknown>>) {
    await saveAppsConfig({ apps } as never);
  }

  async function installFakePackage(packageName: string) {
    const dir = path.join(
      tmpHome,
      "plugins",
      "node_modules",
      ...packageName.split("/")
    );
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: packageName,
          version: "1.0.0",
          type: "module",
          main: "index.mjs",
        },
        null,
        2
      ),
      "utf-8"
    );
    await fs.writeFile(path.join(dir, "index.mjs"), FAKE_APP_SOURCE, "utf-8");
  }

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-bootstrap-"));
    process.env.GINKGO_HOME = tmpHome;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
    vi.restoreAllMocks();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  it("磁盘配置为唯一事实来源：引导后启用态与顺序与配置一致", async () => {
    await writeConfig([
      { id: "analytics", enabled: true, builtin: true },
      { id: "general", enabled: false, builtin: true },
      { id: "design", enabled: true, builtin: true },
    ]);

    await bootstrapApps();

    expect(appRegistry.list().map((a) => a.manifest.id)).toEqual([
      "analytics",
      "design",
    ]);
    expect(appRegistry.isAppEnabled("general")).toBe(false);
    expect(getAppsBootstrapReport()?.storageRoot).toBe(tmpHome);
  });

  it("已安装的第三方应用在重启后重新注册（安装不等于一次性有效）", async () => {
    await installFakePackage("@demo/app");
    await writeConfig([
      { id: "analytics", enabled: true, builtin: true },
      { id: "demo", package: "@demo/app", enabled: true, builtin: false },
    ]);

    const report = await bootstrapApps();

    expect(report.failures).toEqual([]);
    expect(report.registeredAppIds).toContain("demo");
    expect(appRegistry.has("demo")).toBe(true);
    expect(appRegistry.isAppEnabled("demo")).toBe(true);
    expect(appRegistry.getEnabled("demo")?.manifest.name).toBe("演示插件");
  });

  it("单个应用载入失败不阻断引导，失败原因可查询", async () => {
    await writeConfig([
      { id: "analytics", enabled: true, builtin: true },
      { id: "ghost", package: "@ghost/missing", enabled: true, builtin: false },
    ]);

    const report = await bootstrapApps();

    // 引导本身成功、内置应用照常在位
    expect(appRegistry.isAppEnabled("analytics")).toBe(true);
    expect(report.registeredAppIds).not.toContain("ghost");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].id).toBe("ghost");
    expect(getAppLoadFailure("ghost")).toContain("无法在插件目录解析包");
  });

  it("配置声明的 id 与包 manifest.id 不一致时拒绝注册（防冒名）", async () => {
    await installFakePackage("@demo/app");
    await writeConfig([
      { id: "analytics", enabled: true, builtin: true },
      // 配置写 demo2，但包内 manifest.id 是 demo
      { id: "demo2", package: "@demo/app", enabled: true, builtin: false },
    ]);

    const report = await bootstrapApps();

    expect(appRegistry.has("demo2")).toBe(false);
    expect(report.failures[0].message).toContain("不一致");
  });

  it("第三方包不得占用内置 id（防覆盖平台能力）", async () => {
    await installFakePackage("@demo/app");
    await writeConfig([
      { id: "analytics", enabled: true, builtin: true },
      // builtin:false 但 id 与内置 analytics 冲突
      { id: "analytics", package: "@demo/app", enabled: true, builtin: false },
    ]);

    const report = await bootstrapApps();

    // 内置 analytics 仍是内置实现
    expect(appRegistry.get("analytics")?.manifest.name).not.toBe("演示插件");
    expect(report.failures.some((f) => f.message.includes("内置应用占用"))).toBe(
      true
    );
  });

  it("幂等单飞：重复调用复用同一 Promise，只解析一次包", async () => {
    await installFakePackage("@demo/app");
    await writeConfig([
      { id: "analytics", enabled: true, builtin: true },
      { id: "demo", package: "@demo/app", enabled: true, builtin: false },
    ]);

    const resolveSpy = vi.spyOn(AppPackageManager, "resolveInstalledPackage");

    const p1 = bootstrapApps();
    const p2 = bootstrapApps();
    expect(p1).toBe(p2);

    await Promise.all([p1, p2]);
    await bootstrapApps();

    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it("配置损坏时降级引导：仍注册内置应用并记录告警", async () => {
    const configPath = path.join(tmpHome, "config", "apps.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{ broken", "utf-8");

    const report = await bootstrapApps();

    expect(report.warning).toContain("损坏");
    expect(report.registeredAppIds).toContain("analytics");
    expect(appRegistry.isAppEnabled("analytics")).toBe(true);
  });
});
