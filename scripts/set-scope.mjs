#!/usr/bin/env node
/**
 * 批量切换 npm scope（如 `@ginkgolab/*` → `@ginkgolab/*`）。
 *
 * 为什么需要它：npm 的 scope 等于「组织/用户名」，唯一且不可抢。一旦目标 scope 不可用，
 * 就要把 10 个包名 + 全仓 import 引用 + 文档一起改，手工做容易漏（尤其仓库根目录的
 * AGENTS.md / README 不在 packages|src 下）。本脚本把这件事变成一条命令且可 dry-run。
 *
 * 用法：
 *   node scripts/set-scope.mjs @ginkgolab            # 执行
 *   node scripts/set-scope.mjs @ginkgolab --dry-run  # 只看会改什么
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOTS = ["src", "packages", "docs", "config", "scripts", ".github"];
const ROOT_FILES = ["AGENTS.md", "README.md", "package.json"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".json", ".md", ".yml", ".yaml"]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".next", ".git", "coverage", ".dsh-browser", "cache", ".zcode",
]);

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!target || !/^@[a-z0-9][a-z0-9-]*$/.test(target)) {
  console.error("用法: node scripts/set-scope.mjs @<scope> [--dry-run]");
  process.exit(1);
}

/** 从 app-sdk 包名推断当前 scope（唯一事实来源） */
async function detectCurrentScope() {
  const pkg = JSON.parse(
    await fs.readFile("packages/ginkgo-app-sdk/package.json", "utf-8")
  );
  const match = /^(@[a-z0-9][a-z0-9-]*)\//.exec(pkg.name);
  if (!match) throw new Error(`无法从包名推断 scope: ${pkg.name}`);
  return match[1];
}

async function collect(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const current = await detectCurrentScope();
if (current === target) {
  console.log(`scope 已是 ${target}，无需改动。`);
  process.exit(0);
}

const files = [];
for (const root of ROOTS) await collect(root, files);
for (const f of ROOT_FILES) files.push(f);

const from = `${current}/`;
const to = `${target}/`;
const changed = [];

for (const file of files) {
  let content;
  try {
    content = await fs.readFile(file, "utf-8");
  } catch {
    continue;
  }
  if (!content.includes(from)) continue;
  const hits = content.split(from).length - 1;
  changed.push({ file, hits });
  if (!dryRun) {
    await fs.writeFile(file, content.split(from).join(to), "utf-8");
  }
}

const totalHits = changed.reduce((sum, c) => sum + c.hits, 0);
console.log(`${dryRun ? "[dry-run] " : ""}${current} → ${target}`);
console.log(`涉及文件 ${changed.length} 个，替换 ${totalHits} 处`);
for (const { file, hits } of changed.slice(0, 12)) console.log(`  ${file} (${hits})`);
if (changed.length > 12) console.log(`  ... 其余 ${changed.length - 12} 个文件`);

if (!dryRun) {
  console.log("\n后续必须执行：");
  console.log("  rm -rf .next node_modules/@" + current.slice(1));
  console.log("  pnpm install && pnpm verify");
}
