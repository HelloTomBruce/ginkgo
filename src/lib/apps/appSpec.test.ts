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
    async function installFakePackage(packageName: string, source: string) {
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
          { name: packageName, version: "1.0.0", type: "module", main: "index.mjs" },
          null,
          2
        ),
        "utf-8"
      );
      await fs.writeFile(path.join(dir, "index.mjs"), source, "utf-8");
    }

    it("按 Node 解析规则载入包并返回 default 导出", async () => {
      await installFakePackage(
        "@demo/app",
        `export default { manifest: { id: "demo", name: "D", description: "", icon: "Bot" },
           client: { welcomeMessage: "hi", presetQueries: [] }, server: { buildSystemPrompt: () => "p" } };`
      );

      const pkg = await resolveInstalledPackage("@demo/app");
      expect(pkg.manifest.id).toBe("demo");
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
