#!/usr/bin/env node
/**
 * 统一推进 10 个待发布包的版本（防漏、防手改 JSON 出错）。
 *
 * 为什么必须整体推进：内部依赖是 `workspace:*`，发布时被重写成**精确版本**，
 * 所以「只升 leaf 不升下游」会让下游 manifest 继续 pin 旧版本，消费者静默拿到旧包。
 * 详见 docs/package-publishing.md。
 *
 * 用法：
 *   node scripts/bump-version.mjs patch|minor|major   # 基于当前版本递增
 *   node scripts/bump-version.mjs 0.1.2               # 指定版本
 *   ... [--dry-run]                                    # 只打印计划
 *   ... [--force]                                      # 版本已不一致时强制对齐（中断恢复）
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
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const input = args.find((a) => !a.startsWith("--"));

if (!input) {
  console.error("用法: node scripts/bump-version.mjs <patch|minor|major|X.Y.Z> [--dry-run]");
  process.exit(1);
}

const readPkg = async (dir) =>
  JSON.parse(await fs.readFile(`${dir}/package.json`, "utf-8"));

/** 读出当前版本并断言一致（版本漂移时先停下，而不是盲目递增） */
async function currentVersion() {
  const versions = new Map();
  for (const dir of PACKAGES) {
    const pkg = await readPkg(dir);
    versions.set(pkg.name, pkg.version);
  }
  const unique = new Set(versions.values());
  if (unique.size > 1) {
    if (force) {
      console.warn("⚠️  版本已不一致，按 --force 对齐到目标版本：");
      for (const [name, v] of versions) console.warn(`  ${name}@${v}`);
      return [[...versions.values()][0], versions];
    }
    console.error("待发布包版本已不一致（可能是上次批量写被中断）：");
    for (const [name, v] of versions) console.error(`  ${name}@${v}`);
    console.error(
      `\n用目标版本重跑即可一次性对齐：\n  node scripts/bump-version.mjs <目标版本> --force`
    );
    process.exit(1);
  }
  return [[...versions.values()][0], versions];
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

function computeNext(current, spec) {
  if (SEMVER.test(spec)) return spec;
  const [, major, minor, patch] = SEMVER.exec(current) ?? [];
  if (!major) throw new Error(`当前版本无法解析: ${current}`);
  const [M, m, p] = [Number(major), Number(minor), Number(patch)];
  if (spec === "major") return `${M + 1}.0.0`;
  if (spec === "minor") return `${M}.${m + 1}.0`;
  if (spec === "patch") return `${M}.${m}.${p + 1}`;
  throw new Error(`无法识别的版本参数: ${spec}（期望 patch|minor|major|X.Y.Z）`);
}

const [current, versions] = await currentVersion();
let next;
try {
  next = computeNext(current, input);
} catch (err) {
  console.error(String(err.message ?? err));
  console.error("用法: node scripts/bump-version.mjs <patch|minor|major|X.Y.Z> [--dry-run]");
  process.exit(1);
}

if (!SEMVER.test(next)) {
  console.error(`目标版本非法: ${next}`);
  process.exit(1);
}
// 版本不一致时（中断恢复）即使目标等于首个包的版本也必须继续写——否则会留下漂移
const inconsistent = new Set(versions.values()).size > 1;
if (!inconsistent && next === current) {
  console.error(`目标版本与当前一致（${current}），无需推进`);
  process.exit(1);
}

console.log(`${dryRun ? "[dry-run] " : ""}${current} → ${next}（${versions.size} 个包）`);

for (const dir of PACKAGES) {
  const pkg = await readPkg(dir);
  if (!dryRun) {
    pkg.version = next;
    await fs.writeFile(
      `${dir}/package.json`,
      JSON.stringify(pkg, null, 2) + "\n",
      "utf-8"
    );
  }
  console.log(`  ${dryRun ? "会改" : "已改"} ${pkg.name.padEnd(26)} ${current} → ${next}`);
}

if (!dryRun) {
  // 落盘后回读校验：批量写不是原子的，必须确认 10 个文件都到位
  const reread = new Set();
  for (const dir of PACKAGES) reread.add((await readPkg(dir)).version);
  if (reread.size !== 1 || !reread.has(next)) {
    console.error(`❌ 写入后校验失败，实际版本集合：${[...reread].join(", ")}`);
    console.error("   重新执行同一命令（可加 --force）即可对齐。");
    process.exit(1);
  }
}

if (!dryRun) {
  const tag = `v${next}`;
  console.log(`
后续步骤：
  node scripts/release-version.mjs ${tag}
  pnpm verify
  pnpm -r --filter "./packages/**" run build
  pnpm pkg:verify && pnpm pkg:smoke
  git commit -am "chore(release): ${tag}"
  git tag -a ${tag} -m "${tag}" && git push origin ${tag}`);
}
