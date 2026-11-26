import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  AppsConfigCorruptError,
  getAppsConfigFile,
  loadAppsConfig,
  loadAppsConfigWithFallback,
  mutateAppsConfig,
  resetCorruptBackupCacheForTesting,
  saveAppsConfig,
  withAppsConfigLock,
} from "./appConfigServer";
import { resetStorageRootCacheForTesting } from "@/lib/storagePaths";

describe("appConfigServer 服务端应用配置读写管理", () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-config-test-"));
    process.env = { ...originalEnv, GINKGO_HOME: tmpDir };
    // 存储根按进程缓存：用例间切换 GINKGO_HOME 必须重置，否则会写到上一个用例的目录
    resetStorageRootCacheForTesting();
    resetCorruptBackupCacheForTesting();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetStorageRootCacheForTesting();
    resetCorruptBackupCacheForTesting();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("当目标配置文件不存在时，loadAppsConfig 返回默认初始配置", async () => {
    const config = await loadAppsConfig();
    expect(config.apps).toBeDefined();
    expect(config.apps.length).toBeGreaterThan(0);
    expect(config.apps.map((a) => a.id)).toContain("analytics");
  });

  it("saveAppsConfig 成功写入并在 loadAppsConfig 中被重新读取", async () => {
    const customConfig = {
      apps: [
        { id: "analytics", enabled: true },
        { id: "design", enabled: false },
      ],
    };

    await saveAppsConfig(customConfig);
    const loaded = await loadAppsConfig();

    expect(loaded.apps).toEqual([
      { id: "analytics", enabled: true },
      { id: "design", enabled: false },
    ]);
  });

  describe("损坏配置：不静默覆盖（数据丢失级缺陷回归）", () => {
    it("JSON 无法解析时抛 AppsConfigCorruptError，并保留 .corrupt-* 备份现场", async () => {
      const configPath = getAppsConfigFile();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, '{"apps": [', "utf-8");

      await expect(loadAppsConfig()).rejects.toBeInstanceOf(AppsConfigCorruptError);

      const backups = (await fs.readdir(path.dirname(configPath))).filter((n) =>
        n.startsWith("apps.json.corrupt-")
      );
      expect(backups.length).toBe(1);
      // 现场未被覆盖：损坏内容仍在
      expect(await fs.readFile(configPath, "utf-8")).toBe('{"apps": [');
    });

    it("形态非法（缺 apps 数组）同样视为损坏", async () => {
      const configPath = getAppsConfigFile();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify({ version: 2 }), "utf-8");

      await expect(loadAppsConfig()).rejects.toBeInstanceOf(AppsConfigCorruptError);
    });

    it("清空进程内记忆（模拟另一套模块图）后仍复用同一份备份", async () => {
      const configPath = getAppsConfigFile();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "same-broken-content", "utf-8");

      await loadAppsConfigWithFallback();
      // Next 的 instrumentation 与路由 handler 是两套模块图，各自持有模块级缓存
      resetCorruptBackupCacheForTesting();
      await loadAppsConfigWithFallback();

      const backups = (await fs.readdir(path.dirname(configPath))).filter((n) =>
        n.startsWith("apps.json.corrupt-")
      );
      expect(backups).toHaveLength(1);
    });

    it("重复降级读取只产生一份备份（防止配置目录无限堆积）", async () => {
      const configPath = getAppsConfigFile();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "broken-again", "utf-8");

      await loadAppsConfigWithFallback();
      await loadAppsConfigWithFallback();
      await loadAppsConfigWithFallback();

      const backups = (await fs.readdir(path.dirname(configPath))).filter((n) =>
        n.startsWith("apps.json.corrupt-")
      );
      expect(backups.length).toBe(1);
    });

    it("只读展示路径降级为初始配置且带 warning，不抛错", async () => {
      const configPath = getAppsConfigFile();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "not-json", "utf-8");

      const { config, warning } = await loadAppsConfigWithFallback();
      expect(config.apps.map((a) => a.id)).toContain("analytics");
      expect(warning).toContain("损坏");
    });

    it("写路径遇损坏配置直接失败，绝不覆盖用户文件", async () => {
      const configPath = getAppsConfigFile();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "broken", "utf-8");

      await expect(
        mutateAppsConfig((cfg) => {
          cfg.apps.push({ id: "x" });
        })
      ).rejects.toBeInstanceOf(AppsConfigCorruptError);

      expect(await fs.readFile(configPath, "utf-8")).toBe("broken");
    });
  });

  describe("并发写：互斥锁与原子读改写", () => {
    it("并发 mutate 不丢更新（read-modify-write 串行化）", async () => {
      await saveAppsConfig({ apps: [{ id: "base", enabled: true }] });

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          mutateAppsConfig((cfg) => {
            cfg.apps.push({ id: `app_${i}`, enabled: true });
          })
        )
      );

      const loaded = await loadAppsConfig();
      expect(loaded.apps).toHaveLength(11);
      expect(new Set(loaded.apps.map((a) => a.id)).size).toBe(11);
    });

    it("withAppsConfigLock 在单次任务抛错后仍可继续（链条不中断）", async () => {
      await expect(
        withAppsConfigLock(async () => {
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      await expect(withAppsConfigLock(async () => "ok")).resolves.toBe("ok");
    });
  });
});
