#!/usr/bin/env node
/**
 * 按依赖 DAG 分层发布，跳过已存在的版本（可重复执行）。
 *
 * 为什么用脚本而不是 workflow 里写 10 个 publish 步骤：
 *   1. 层顺序与"跳过已发布"要在一处表达，失败后重跑不会因为某个包已存在而卡死；
 *   2. 本地手动发布与 CI 走同一条路径，避免"本地能发、CI 发不出去"。
 *
 * 用法：node scripts/publish-packages.mjs [--dry-run] [--provenance]
 * 需要：npm 登录态（本地）或 NODE_AUTH_TOKEN（CI）。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DRY_RUN = process.argv.includes("--dry-run");
const PROVENANCE = process.argv.includes("--provenance");

/** 依赖 DAG 分层：上层依赖下层的全部包 */
const LAYERS = [
  ["packages/ginkgo-app-sdk", "packages/ginkgo-models", "packages/ginkgo-chart-spec", "packages/ginkgo-datasources"],
  ["packages/ginkgo-components", "packages/ginkgo-harness-core"],
  ["packages/ginkgo-sandbox", "packages/ginkgo-llm"],
  ["packages/apps/app-analytics", "packages/apps/app-design"],
];

const exists = async (name, version) => {
  try {
    const { stdout } = await execFileAsync("npm", ["view", `${name}@${version}`, "version"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim() === version;
  } catch {
    return false;
  }
};

const published = [];
const skipped = [];

for (const [index, layer] of LAYERS.entries()) {
  console.log(`\n=== 第 ${index + 1} 层 ===`);
  for (const dir of layer) {
    const pkg = JSON.parse(await fs.readFile(`${dir}/package.json`, "utf-8"));
    const { name, version } = pkg;

    if (await exists(name, version)) {
      console.log(`  ⏭  ${name}@${version} 已存在，跳过`);
      skipped.push(`${name}@${version}`);
      continue;
    }

    const args = ["publish", "--access", "public", "--no-git-checks"];
    if (PROVENANCE) args.push("--provenance");

    if (DRY_RUN) {
      console.log(`  ▶  ${name}@${version}（dry-run：跳过实际上传）`);
      continue;
    }

    console.log(`  ⬆  ${name}@${version}`);
    try {
      const { stdout } = await execFileAsync("pnpm", args, {
        cwd: dir,
        maxBuffer: 32 * 1024 * 1024,
      });
      const tail = stdout.trim().split("\n").slice(-2).join(" | ");
      console.log(`     ${tail}`);
      published.push(`${name}@${version}`);
    } catch (err) {
      console.error(`  ❌ ${name}@${version} 发布失败：`);
      console.error(String(err).slice(0, 2000));
      process.exit(1);
    }
  }
}

console.log(`\n新发布 ${published.length} 个，跳过 ${skipped.length} 个。`);
if (published.length) published.forEach((p) => console.log(`  + ${p}`));
