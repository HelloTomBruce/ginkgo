import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import vitestConfig from "../../vitest.config";

/**
 * 打包/分发守卫（可执行断言）。
 *
 * 与 architecture-guards 同一思路：把「发布前必须记得做的事」变成 CI 会跑的
 * 测试，而不是靠 code review 或人肉流程。当前守卫两条：
 *   1. @ginkgolab/cli 的 seeds 必须与仓库根 config 逐字节一致——seeds 是
 *      config 的发布复制物，漂移意味着 npm 用户拿到的默认配置是旧的；
 *   2. vitest.config 的 projects 显式清单必须覆盖 packages/ 全部包
 *      （ginkgo-cli 分发包除外）——清单漏登记会让新包的测试静默不跑。
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const CONFIG_DIR = path.join(REPO_ROOT, "config");
const SEEDS_DIR = path.join(REPO_ROOT, "packages", "ginkgo-cli", "seeds");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

describe("打包/分发守卫", () => {
  it("ginkgo-cli seeds 与 config/*.json 逐字节一致（改 config 后须重跑 pnpm cli:assemble）", async () => {
    const configFiles = (await fs.readdir(CONFIG_DIR)).filter((f) => f.endsWith(".json"));
    expect(configFiles.length, "config 目录应存在种子配置").toBeGreaterThan(0);

    const seedFiles = new Set((await fs.readdir(SEEDS_DIR)).filter((f) => f.endsWith(".json")));

    // 不允许 seeds 里有 config 已删除的残留文件
    const stale = [...seedFiles].filter((f) => !configFiles.includes(f));
    expect(stale, `seeds 中存在 config 已不存在的残留文件: ${stale.join(", ")}`).toEqual([]);

    for (const file of configFiles) {
      expect(
        seedFiles.has(file),
        `config/${file} 尚未同步到 seeds（跑 pnpm cli:assemble）`
      ).toBe(true);
      const [configSrc, seedSrc] = await Promise.all([
        fs.readFile(path.join(CONFIG_DIR, file), "utf-8"),
        fs.readFile(path.join(SEEDS_DIR, file), "utf-8"),
      ]);
      expect(seedSrc, `seeds/${file} 与 config/${file} 内容漂移（跑 pnpm cli:assemble）`).toBe(
        configSrc
      );
    }
  });

  it("vitest projects 清单覆盖 packages/ 全部包（ginkgo-cli 分发包除外）", () => {
    // ginkgo-cli 是纯 launcher + 组装产物目录，无自身单测，被显式排除；
    // 其余任何新增包必须登记进清单，否则其测试会静默不跑。
    const EXCLUDED = new Set(["ginkgo-cli"]);

    const projects = vitestConfig.test?.projects ?? [];
    const registered = new Set(projects.filter((p) => p !== "."));

    expect(registered.has("packages/apps/*"), "packages/apps/* 应以 glob 形式登记").toBe(true);

    let checked = 0;
    for (const name of fsSync.readdirSync(PACKAGES_DIR)) {
      // apps 是应用包容器目录（子包由上面的 packages/apps/* glob 覆盖），跳过
      if (EXCLUDED.has(name) || name === "apps") continue;
      checked++;
      expect(
        registered.has(`packages/${name}`),
        `packages/${name} 未登记进 vitest.config projects，其测试不会被执行`
      ).toBe(true);
    }
    expect(checked, "packages/ 目录应存在能力包").toBeGreaterThan(0);
  });
});
