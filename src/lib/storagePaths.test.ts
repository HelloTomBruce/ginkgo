import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getGinkgoHomeDir,
  getStoragePath,
  getSessionStorageDir,
  getDashboardStorageDir,
  getWorkspaceStorageFile,
  getConfigDir,
  getPluginsDir,
  getFileStorageDir,
  getMcpServersFile,
  hasLegacyLocalStorage,
  resolveGinkgoHomeDir,
  resetStorageRootCacheForTesting,
  writeJsonAtomic,
} from "./storagePaths";

/**
 * 存储根解析的核心承诺：
 *   1. 显式配置（GINKGO_HOME / GINKGO_DATA_DIR）最高优先；
 *   2. 既有本地 ./data 或 ./config 存在时**不搬家**（升级零变更）；
 *   3. 全新安装落 ~/.ginkgo；
 *   4. 解析结果下发 GINKGO_RESOLVED_HOME，供能力包/应用包对齐。
 */
describe("storagePaths 统一存储根解析器", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    resetStorageRootCacheForTesting();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-storage-test-"));
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("resolveGinkgoHomeDir（纯函数，穷举三分支）", () => {
    it("GINKGO_HOME 最高优先，相对路径按 cwd 解析", async () => {
      const cwd = path.join(tmpDir, "repo");
      await fs.mkdir(cwd, { recursive: true });

      expect(
        resolveGinkgoHomeDir({ GINKGO_HOME: "/custom/home" }, cwd)
      ).toBe(path.resolve("/custom/home"));
      expect(resolveGinkgoHomeDir({ GINKGO_HOME: "relative/home" }, cwd)).toBe(
        path.join(cwd, "relative/home")
      );
    });

    it("GINKGO_DATA_DIR 作为旧变量名兼容生效", async () => {
      const cwd = path.join(tmpDir, "repo");
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveGinkgoHomeDir({ GINKGO_DATA_DIR: "/opt/data" }, cwd)).toBe(
        path.resolve("/opt/data")
      );
    });

    it("既有 ./data 时沿用 cwd（升级零变更，与 NODE_ENV 无关）", async () => {
      const cwd = path.join(tmpDir, "legacy");
      await fs.mkdir(path.join(cwd, "data"), { recursive: true });

      expect(hasLegacyLocalStorage(cwd)).toBe(true);
      // 关键回归：production 也必须落在 cwd，历史实现会误跳到 ~/.ginkgo
      expect(
        resolveGinkgoHomeDir({ NODE_ENV: "production", HOME: "/home/u" }, cwd)
      ).toBe(cwd);
    });

    it("既有 ./config 同样视为历史布局", async () => {
      const cwd = path.join(tmpDir, "legacy-config");
      await fs.mkdir(path.join(cwd, "config"), { recursive: true });

      expect(resolveGinkgoHomeDir({ HOME: "/home/u" }, cwd)).toBe(cwd);
    });

    it("全新安装（无 data/config）落 ~/.ginkgo，production 与 development 一致", async () => {
      const cwd = path.join(tmpDir, "fresh");
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveGinkgoHomeDir({ HOME: "/home/u" }, cwd)).toBe(
        path.join("/home/u", ".ginkgo")
      );
      expect(
        resolveGinkgoHomeDir({ HOME: "/home/u", NODE_ENV: "development" }, cwd)
      ).toBe(path.join("/home/u", ".ginkgo"));
    });

    it("Windows 主目录回退 USERPROFILE / HOMEPATH", async () => {
      const cwd = path.join(tmpDir, "fresh-win");
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveGinkgoHomeDir({ USERPROFILE: "/Users/win" }, cwd)).toBe(
        path.join("/Users/win", ".ginkgo")
      );
      expect(resolveGinkgoHomeDir({ HOMEPATH: "/home/win" }, cwd)).toBe(
        path.join("/home/win", ".ginkgo")
      );
    });
  });

  describe("getGinkgoHomeDir（进程缓存 + 环境变量下发）", () => {
    it("显式配置下各分类路径统一落在同一根，并下发 GINKGO_RESOLVED_HOME", () => {
      process.env.GINKGO_HOME = path.join(tmpDir, "home");
      delete process.env.GINKGO_DATA_DIR;

      expect(getGinkgoHomeDir()).toBe(path.join(tmpDir, "home"));
      expect(getSessionStorageDir()).toBe(
        path.join(tmpDir, "home", "data", "sessions")
      );
      expect(getDashboardStorageDir()).toBe(
        path.join(tmpDir, "home", "data", "dashboards")
      );
      expect(getWorkspaceStorageFile()).toBe(
        path.join(tmpDir, "home", "data", "workspaces", "_workspaces.json")
      );
      expect(getFileStorageDir()).toBe(path.join(tmpDir, "home", "data", "files"));
      expect(getConfigDir()).toBe(path.join(tmpDir, "home", "config"));
      expect(getPluginsDir()).toBe(path.join(tmpDir, "home", "plugins"));
      expect(getMcpServersFile()).toBe(
        path.join(tmpDir, "home", "config", "mcp-servers.json")
      );
      expect(getStoragePath("data", "methodology")).toBe(
        path.join(tmpDir, "home", "data", "methodology")
      );

      // 跨包契约：能力包/应用包经此环境变量读同一根
      expect(process.env.GINKGO_RESOLVED_HOME).toBe(path.join(tmpDir, "home"));
    });

    it("解析结果进程内缓存：后续环境变量变化不影响已解析的根", () => {
      process.env.GINKGO_HOME = path.join(tmpDir, "first");
      expect(getGinkgoHomeDir()).toBe(path.join(tmpDir, "first"));

      process.env.GINKGO_HOME = path.join(tmpDir, "second");
      expect(getGinkgoHomeDir()).toBe(path.join(tmpDir, "first"));
    });
  });

  describe("writeJsonAtomic 原子写", () => {
    it("写入合法 JSON 且不残留临时文件", async () => {
      const target = path.join(tmpDir, "nested", "apps.json");
      await writeJsonAtomic(target, { apps: [{ id: "analytics" }] });

      const parsed = JSON.parse(await fs.readFile(target, "utf-8"));
      expect(parsed.apps[0].id).toBe("analytics");

      const siblings = await fs.readdir(path.dirname(target));
      expect(siblings).toEqual(["apps.json"]);
    });

    it("覆盖已有文件时不产生半截内容（读到的一定是完整 JSON）", async () => {
      const target = path.join(tmpDir, "apps.json");
      await writeJsonAtomic(target, { v: 1 });
      await writeJsonAtomic(target, { v: 2 });

      expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual({ v: 2 });
    });

    it("重复写入大对象后目录内始终只有一个目标文件", async () => {
      const target = path.join(tmpDir, "big.json");
      for (let i = 0; i < 5; i += 1) {
        await writeJsonAtomic(target, { i, payload: "x".repeat(1000) });
      }
      const siblings = await fs.readdir(path.dirname(target));
      expect(siblings).toEqual(["big.json"]);
    });
  });
});
