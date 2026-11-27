#!/usr/bin/env node
/**
 * 发布版本一致性校验：tag 必须等于所有待发布包的 version。
 *
 * 运行时机：CI 在 tag 触发时、以及本地打 tag 前。
 * 用法：node scripts/release-version.mjs [v0.1.1]   # 省略时读 GITHUB_REF_NAME
 */
import fs from "node:fs/promises";

const PACKAGES = [
  "packages/ginkgo-app-sdk",
  "packages/ginkgo-models",
  "packages/ginkgo-chart-spec",
  "packages/ginkgo-datasources",
  "packages/ginkgo-components",
  "packages/ginkgo-harness-core",
  "packages/ginkgo-sandbox",
  "packages/ginkgo-llm",
  "packages/apps/app-analytics",
  "packages/apps/app-design",
  "packages/ginkgo-cli",
];

const tag = (process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "").trim();
if (!/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error(`tag 形态非法：${tag || "(空)"}，期望 vX.Y.Z`);
  process.exit(1);
}
const tagVersion = tag.replace(/^v/, "");

const versions = new Map();
for (const dir of PACKAGES) {
  const pkg = JSON.parse(await fs.readFile(`${dir}/package.json`, "utf-8"));
  versions.set(pkg.name, pkg.version);
}

const mismatched = [...versions].filter(([, v]) => v !== tagVersion);
const unique = new Set(versions.values());

if (unique.size > 1) {
  console.error("待发布包版本不一致：");
  for (const [name, v] of versions) console.error(`  ${name}@${v}`);
  process.exit(1);
}
if (mismatched.length > 0) {
  console.error(`tag ${tag} 与包版本不一致（包版本 ${[...unique].join(",")}）：`);
  for (const [name, v] of mismatched) console.error(`  ${name}@${v}`);
  console.error("\n请统一 package.json 版本后再打 tag。");
  process.exit(1);
}

console.log(`✅ tag ${tag} 与 ${versions.size} 个包版本一致（${tagVersion}）`);
