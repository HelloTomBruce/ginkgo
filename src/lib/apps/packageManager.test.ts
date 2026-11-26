import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AppPackageManager } from "./packageManager";
import { appRegistry } from "./registry";
import { loadAppsConfig } from "./appConfigServer";
import { resetStorageRootCacheForTesting } from "@/lib/storagePaths";
import { resetAppsBootstrapForTesting } from "./bootstrap";
import type { AppPackageDefinition } from "@ginkgo/app-sdk";

/**
 * npm 调用全部拦在进程外：测试不得真的跑 npm（慢且会污染本机缓存）。
 * `execFile` 是回调风格，`promisify` 依赖其 (err, result) 形状。
 */
const execFileMock = vi.fn(
  (
    _cmd: string,
    _args: readonly string[],
    _opts: unknown,
    cb: (err: unknown, res?: { stdout: string; stderr: string }) => void
  ) => {
    cb(null, { stdout: "", stderr: "" });
  }
);

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) =>
    (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

function makeApp(overrides: Partial<AppPackageDefinition["manifest"]> = {}): AppPackageDefinition {
  return {
    manifest: {
      id: "mock_extension",
      name: "Mock 扩展应用",
      version: "1.0.0",
      description: "动态插件测试",
      icon: "Box",
      ...overrides,
    },
    client: { welcomeMessage: "Hi Extension", presetQueries: [] },
    server: { buildSystemPrompt: () => "prompt" },
  };
}

describe("AppPackageManager 运行时包管理器", () => {
  const originalEnv = process.env;
  let tmpHome: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-pkg-test-"));
    process.env.GINKGO_HOME = tmpHome;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
    execFileMock.mockClear();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    resetAppsBootstrapForTesting();
    vi.restoreAllMocks();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  it("ensurePluginsDir 自动建立插件目录并写入初始 package.json", async () => {
    const pluginsDir = await AppPackageManager.ensurePluginsDir();
    const pkgJsonPath = path.join(pluginsDir, "package.json");
    const content = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));
    expect(content.name).toBe("ginkgo-plugins");
  });

  describe("spec 校验（安装链路的信任边界）", () => {
    it.each([
      ["../../etc/passwd", "路径穿越"],
      ["@demo/../../escape", "路径穿越"],
      ["lodash", "裸包名"],
      ["", "空"],
      ["@demo/app; rm -rf /", "元字符"],
      ["@demo/app extra", "空白"],
    ])("拒绝非法 spec: %s", async (spec) => {
      const result = await AppPackageManager.installPackage(spec, {
        mockPackage: makeApp(),
      });
      expect(result.success).toBe(false);
      expect(result.code).toBe("invalid_spec");
      // 关键：非法 spec 不得触达 npm
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("接受 @scope/name 与带版本号的形态", async () => {
      const ok1 = await AppPackageManager.installPackage("@demo/app", {
        mockPackage: makeApp({ id: "demo_a" }),
      });
      expect(ok1.success).toBe(true);

      const ok2 = await AppPackageManager.installPackage("@demo/app@1.2.3", {
        mockPackage: makeApp({ id: "demo_b" }),
      });
      expect(ok2.success).toBe(true);
    });

    it("本地 tarball 默认关闭，开启后放行", async () => {
      const denied = await AppPackageManager.installPackage("/tmp/x.tgz", {
        mockPackage: makeApp(),
      });
      expect(denied.code).toBe("invalid_spec");

      process.env.GINKGO_ALLOW_LOCAL_APP_PACKAGE = "1";
      const allowed = await AppPackageManager.installPackage("/tmp/x.tgz", {
        mockPackage: makeApp({ id: "from_tarball" }),
      });
      expect(allowed.success).toBe(true);
    });
  });

  it("installPackage 支持生命周期钩子并持久化到 apps.json", async () => {
    const onInstallSpy = vi.fn().mockResolvedValue({ success: true });
    const result = await AppPackageManager.installPackage("@custom/mock-app", {
      mockPackage: makeApp({ lifecycle: { onInstall: onInstallSpy } }),
    });

    expect(result.success).toBe(true);
    expect(result.appId).toBe("mock_extension");
    expect(onInstallSpy).toHaveBeenCalled();

    const config = await loadAppsConfig();
    expect(config.apps.find((a) => a.id === "mock_extension")?.package).toBe(
      "@custom/mock-app"
    );
  });

  it("内置应用 id 不可被动态包覆盖", async () => {
    const result = await AppPackageManager.installPackage("@evil/analytics", {
      mockPackage: makeApp({ id: "analytics", name: "冒名应用" }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("内置应用");
    // 内置实现未被替换
    expect(appRegistry.get("analytics")?.manifest.name).not.toBe("冒名应用");
  });

  it("声明 permissions 且未确认时不注册（两段握手第一步）", async () => {
    const result = await AppPackageManager.installPackage("@demo/permy", {
      mockPackage: makeApp({
        id: "permy",
        permissions: ["datasources.read", "shell.execute"],
      }),
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("permissions_required");
    expect(result.requiredPermissions).toEqual([
      "datasources.read",
      "shell.execute",
    ]);
    // 关键：未确认前不得进注册表
    expect(appRegistry.has("permy")).toBe(false);
  });

  it("确认权限后注册，并把确认过的权限留痕到配置", async () => {
    const result = await AppPackageManager.installPackage("@demo/permy", {
      mockPackage: makeApp({
        id: "permy",
        permissions: ["datasources.read", "shell.execute"],
      }),
      acknowledgedPermissions: ["datasources.read", "shell.execute"],
    });

    expect(result.success).toBe(true);
    expect(appRegistry.isAppEnabled("permy")).toBe(true);

    const config = await loadAppsConfig();
    const entry = config.apps.find((a) => a.id === "permy");
    expect(entry?.permissions).toEqual(["datasources.read", "shell.execute"]);
  });

  it("toggleApp 落盘并区分不存在（404）", async () => {
    await AppPackageManager.toggleApp("analytics", false);
    expect(appRegistry.isAppEnabled("analytics")).toBe(false);
    const config = await loadAppsConfig();
    expect(config.apps.find((a) => a.id === "analytics")?.enabled).toBe(false);

    await AppPackageManager.toggleApp("analytics", true);
    expect(appRegistry.isAppEnabled("analytics")).toBe(true);

    const missing = await AppPackageManager.toggleApp("ghost", true);
    expect(missing.success).toBe(false);
    expect(missing.status).toBe(404);
  });

  it("uninstallPackage 触发钩子、真正 npm uninstall、注销并清配置", async () => {
    const onUninstallSpy = vi.fn().mockResolvedValue(undefined);
    await AppPackageManager.installPackage("@demo/removable", {
      mockPackage: makeApp({
        id: "removable_app",
        lifecycle: { onUninstall: onUninstallSpy },
      }),
    });
    expect(appRegistry.isAppEnabled("removable_app")).toBe(true);

    const result = await AppPackageManager.uninstallPackage("removable_app");

    expect(result.success).toBe(true);
    expect(onUninstallSpy).toHaveBeenCalled();

    // 真卸载：包从磁盘摘除（此处断言 npm uninstall 被调用）
    expect(execFileMock).toHaveBeenCalledWith(
      "npm",
      ["uninstall", "@demo/removable"],
      expect.objectContaining({ cwd: expect.any(String) }),
      expect.any(Function)
    );

    // 注销（不是仅停用）：动作网关不再放行
    expect(appRegistry.has("removable_app")).toBe(false);
    expect(appRegistry.isAppEnabled("removable_app")).toBe(false);

    const config = await loadAppsConfig();
    expect(config.apps.find((a) => a.id === "removable_app")).toBeUndefined();
  });

  it("内置应用拒绝卸载（400），不存在应用返回 404", async () => {
    const builtin = await AppPackageManager.uninstallPackage("analytics");
    expect(builtin.success).toBe(false);
    expect(builtin.status).toBe(400);

    const missing = await AppPackageManager.uninstallPackage("ghost");
    expect(missing.success).toBe(false);
    expect(missing.status).toBe(404);
  });

  it("卸载后重新安装仍可成功（幂等）", async () => {
    const spec = "@demo/reinstall";
    await AppPackageManager.installPackage(spec, {
      mockPackage: makeApp({ id: "reinstall_app" }),
    });
    await AppPackageManager.uninstallPackage("reinstall_app");
    expect(appRegistry.has("reinstall_app")).toBe(false);

    const again = await AppPackageManager.installPackage(spec, {
      mockPackage: makeApp({ id: "reinstall_app" }),
    });
    expect(again.success).toBe(true);
    expect(appRegistry.isAppEnabled("reinstall_app")).toBe(true);
  });
});
