import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readPluginDependencies,
  resolveInstalledPackage,
  validatePackageSpec,
} from "./appSpec";
import { resetStorageRootCacheForTesting } from "@/lib/storagePaths";

/** 当前运行时是否支持动态 import（vitest vm 沙箱不支持） */
async function canDynamicImport(): Promise<boolean> {
  try {
    const dynamicImport = new Function("s", "return import(s)") as (
      s: string
    ) => Promise<unknown>;
    await dynamicImport("data:text/javascript,export default 1");
    return true;
  } catch {
    return false;
  }
}

describe("appSpec 包标识校验与模块解析", () => {
  const originalEnv = process.env;
  let tmpHome: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-spec-test-"));
    process.env.GINKGO_HOME = tmpHome;
    resetStorageRootCacheForTesting();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  describe("validatePackageSpec", () => {
    it("接受 @scope/name 与常见版本形态，并正确剥离版本号", () => {
      const cases: Array<[string, string]> = [
        ["@demo/app", "@demo/app"],
        ["@demo/app@1.2.3", "@demo/app"],
        ["@demo/app@^1.2.3", "@demo/app"],
        ["@demo/app@~0.1.0", "@demo/app"],
        ["@demo/app@1.0.0-beta.1", "@demo/app"],
        ["@demo/my-app.v2", "@demo/my-app.v2"],
      ];
      for (const [spec, expectedName] of cases) {
        const result = validatePackageSpec(spec);
        expect(result.ok, spec).toBe(true);
        if (result.ok) {
          expect(result.value.kind).toBe("npm");
          expect(result.value.packageName).toBe(expectedName);
        }
      }
    });

    it("拒绝路径穿越、空白、裸包名、超长、非字符串", () => {
      const bad: Array<[unknown, string]> = [
        ["../../../etc/passwd", ".."],
        ["@demo/../evil", ".."],
        ["lodash", "形态非法"],
        ["@demo/app --registry=http://evil", "空白"],
        ["@demo/app\n@evil/x", "空白"],
        ["@demo/app;reboot", "形态非法"],
        ["@demo/app;rm -rf /", "空白"],
        ["", "不能为空"],
        [null, "必须是字符串"],
        ["@" + "a".repeat(300) + "/b", "上限"],
      ];
      for (const [input, expected] of bad) {
        const result = validatePackageSpec(input as never);
        expect(result.ok, String(input)).toBe(false);
        if (!result.ok) expect(result.reason).toContain(expected);
      }
    });

    it("本地 tarball 需要显式开关", () => {
      expect(validatePackageSpec("/tmp/app.tgz", {}).ok).toBe(false);
      const allowed = validatePackageSpec("/tmp/app.tgz", {
        GINKGO_ALLOW_LOCAL_APP_PACKAGE: "1",
      });
      expect(allowed.ok).toBe(true);
      if (allowed.ok) {
        expect(allowed.value.kind).toBe("tarball");
        expect(allowed.value.packageName).toBeNull();
      }
    });

    it("tarball 也必须挡住路径穿越", () => {
      const result = validatePackageSpec("/tmp/../../etc/evil.tgz", {
        GINKGO_ALLOW_LOCAL_APP_PACKAGE: "1",
      });
      expect(result.ok).toBe(false);
    });

    it("非 tarball 的绝对路径不放行", () => {
      const result = validatePackageSpec("/tmp/app.js", {
        GINKGO_ALLOW_LOCAL_APP_PACKAGE: "1",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("resolveInstalledPackage", () => {
    async function installFakePackage(
      packageName: string,
      source: string,
      entry = "index.cjs",
      packageType?: string
    ) {
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
            main: entry,
            ...(packageType ? { type: packageType } : {}),
          },
          null,
          2
        ),
        "utf-8"
      );
      await fs.writeFile(path.join(dir, entry), source, "utf-8");
    }

    it("按 Node 解析规则载入 CJS 包并返回导出对象", async () => {
      await installFakePackage(
        "@demo/app",
        `module.exports = { manifest: { id: "demo", name: "D", description: "", icon: "Bot" },
           client: { welcomeMessage: "hi", presetQueries: [] }, server: { buildSystemPrompt: () => "p" } };`
      );

      const pkg = await resolveInstalledPackage("@demo/app");
      expect(pkg.manifest.id).toBe("demo");
    });

    // ESM 入口依赖「原生 import」通道。vitest 的 vm 沙箱不支持动态 import
    // （ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING），因此按运行时能力显式跳过；
    // 真实 Next 服务端（Node）走的是这条通道，Phase 3/4 的 e2e 已覆盖。
    it("ESM 入口可被加载（vitest vm 不支持动态 import 时跳过）", async (ctx) => {
      if (!(await canDynamicImport())) {
        ctx.skip();
        return;
      }
      await installFakePackage(
        "@demo/esm",
        `export default { manifest: { id: "esm_demo", name: "ESM", description: "", icon: "Bot" },
           client: { welcomeMessage: "hi", presetQueries: [] }, server: { buildSystemPrompt: () => "p" } };`,
        "index.mjs",
        "module"
      );

      const pkg = await resolveInstalledPackage("@demo/esm");
      expect(pkg.manifest.id).toBe("esm_demo");
    });

    it("包不存在时给出可诊断的错误", async () => {
      await expect(resolveInstalledPackage("@ghost/missing")).rejects.toThrow(
        /无法在插件目录解析包/
      );
    });

    it("readPluginDependencies 读取 plugins/package.json 声明", async () => {
      const pluginsDir = path.join(tmpHome, "plugins");
      await fs.mkdir(pluginsDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginsDir, "package.json"),
        JSON.stringify({ name: "ginkgo-plugins", dependencies: { "@demo/app": "1.0.0" } }),
        "utf-8"
      );

      await expect(readPluginDependencies()).resolves.toEqual({
        "@demo/app": "1.0.0",
      });
    });
  });
});
