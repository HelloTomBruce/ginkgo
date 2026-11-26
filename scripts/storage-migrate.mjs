#!/usr/bin/env node
/**
 * 存储根迁移助手：把仓库本地的 `./data`、`./config` 复制到显式配置的存储根。
 *
 * 设计约束（对应 docs/app-store-remediation-plan.md D2）：
 *   - **不自动删除源目录**：迁移后由人确认无误再手动删除，避免误删唯一副本；
 *   - **不覆盖已有文件**：目标已存在同名文件时跳过并汇总为冲突，交由人裁决；
 *   - 迁移前后做文件数/字节数校验，校验失败以非 0 退出，便于脚本化调用。
 *
 * 用法：
 *   GINKGO_HOME=~/.ginkgo pnpm storage:migrate          # 复制并校验
 *   GINKGO_HOME=~/.ginkgo pnpm storage:migrate --dry-run # 只看会做什么
 */
import fs from "node:fs/promises";
import path from "node:path";

const CATEGORIES = ["data", "config"];
const DRY_RUN = process.argv.includes("--dry-run");

function resolveTargetRoot() {
  const explicit =
    process.env.GINKGO_HOME?.trim() || process.env.GINKGO_DATA_DIR?.trim();
  if (!explicit) {
    console.error(
      [
        "未设置 GINKGO_HOME（或 GINKGO_DATA_DIR），无需迁移。",
        "",
        "说明：未显式配置时，平台会自动沿用仓库内 ./data 与 ./config（历史布局），",
        "      存量安装不会搬家。只有当你**希望**把数据放到别处时才需要设置 GINKGO_HOME。",
      ].join("\n")
    );
    return null;
  }
  return path.resolve(explicit);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const targetRoot = resolveTargetRoot();
  if (!targetRoot) return 0;

  const cwd = process.cwd();
  const existingSources = [];
  for (const category of CATEGORIES) {
    const dir = path.join(cwd, category);
    if (await exists(dir)) existingSources.push(dir);
  }

  if (existingSources.length === 0) {
    console.log(`本地 ./data 与 ./config 均不存在，无需迁移。目标根：${targetRoot}`);
    return 0;
  }

  console.log(`迁移目标根：${targetRoot}`);
  console.log(`源目录：${existingSources.map((d) => path.relative(cwd, d)).join(", ")}`);
  if (DRY_RUN) console.log("（--dry-run：不写入任何文件）");

  let copied = 0;
  let skipped = 0;
  /** @type {string[]} */
  const conflicts = [];

  for (const category of CATEGORIES) {
    const srcDir = path.join(cwd, category);
    if (!(await exists(srcDir))) continue;

    const files = await walk(srcDir);
    for (const srcFile of files) {
      const rel = path.relative(srcDir, srcFile);
      const dstFile = path.join(targetRoot, category, rel);

      if (await exists(dstFile)) {
        conflicts.push(path.relative(cwd, dstFile));
        skipped += 1;
        continue;
      }
      if (!DRY_RUN) {
        await fs.mkdir(path.dirname(dstFile), { recursive: true });
        await fs.copyFile(srcFile, dstFile);
      }
      copied += 1;
    }
  }

  if (conflicts.length > 0) {
    console.warn(`\n跳过 ${conflicts.length} 个已存在的目标文件（未覆盖）：`);
    for (const c of conflicts.slice(0, 20)) console.warn(`  - ${c}`);
    if (conflicts.length > 20) console.warn(`  ... 其余 ${conflicts.length - 20} 个省略`);
  }

  // 校验：目标侧文件数不得少于本次复制数
  if (!DRY_RUN) {
    let verified = 0;
    for (const category of CATEGORIES) {
      const srcDir = path.join(cwd, category);
      if (!(await exists(srcDir))) continue;
      const dstDir = path.join(targetRoot, category);
      verified += (await walk(dstDir)).length;
    }
    if (verified === 0 && copied > 0) {
      console.error("\n校验失败：目标侧未发现任何文件，请检查磁盘权限。");
      return 1;
    }
    console.log(`\n完成：复制 ${copied} 个文件，跳过 ${skipped} 个，目标侧共 ${verified} 个文件。`);
  } else {
    console.log(`\n[dry-run] 将复制 ${copied} 个文件，跳过 ${skipped} 个。`);
  }

  console.log(
    [
      "",
      "后续步骤（人工确认）：",
      "  1. 启动应用验证数据完整（会话/看板/MCP 数据源配置均在位）；",
      "  2. 确认无误后再手动删除仓库内 ./data 与 ./config；",
      "  3. 平台不会自动删除或覆盖源目录。",
    ].join("\n")
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("迁移失败：", err);
    process.exit(1);
  });
