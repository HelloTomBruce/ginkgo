#!/usr/bin/env node
/**
 * 组装 @ginkgolab/cli 产物脚本。
 *
 * 职责：
 *   1. 将 Next.js build 的 .next/standalone 搬运至 packages/ginkgo-cli/runtime
 *   2. 按照 Next.js 生产约定补全 .next/static 与 public
 *   3. 提取默认种子配置文件至 packages/ginkgo-cli/seeds
 *   4. 做完整性校验（确保 server.js、static 等关键产物就绪）
 */
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STANDALONE_DIR = path.join(REPO_ROOT, ".next", "standalone");
const STATIC_DIR = path.join(REPO_ROOT, ".next", "static");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const CONFIG_DIR = path.join(REPO_ROOT, "config");

const CLI_PKG_DIR = path.join(REPO_ROOT, "packages", "ginkgo-cli");
const CLI_RUNTIME_DIR = path.join(CLI_PKG_DIR, "runtime");
const CLI_SEEDS_DIR = path.join(CLI_PKG_DIR, "seeds");

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      // 符号链接在打包发布时需要解开为实体或保持有效相对路径
      try {
        const real = await fs.realpath(srcPath);
        const stat = await fs.stat(real);
        if (stat.isDirectory()) {
          await copyDir(real, destPath);
        } else {
          await fs.copyFile(real, destPath);
        }
      } catch {
        // 若软链断裂则跳过
      }
    } else if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  console.log(`📦 [assemble-cli] 正在组装 @ginkgolab/cli 产物...`);

  // 1. 前置检查
  if (!fssync.existsSync(STANDALONE_DIR)) {
    throw new Error(
      `未找到 .next/standalone。请先运行 'pnpm build'（确保 next.config.ts 已启用 output: "standalone"）`
    );
  }
  if (!fssync.existsSync(STATIC_DIR)) {
    throw new Error(`未找到 .next/static 静态资源目录。`);
  }

  // 2. 清理旧产物。
  // seeds 特殊：config/ 是 gitignore 的本机数据，CI 干净 checkout 上不存在——
  // 那时已提交的 seeds 就是发布事实来源，绝不能清掉后又无法再生。
  await fs.rm(CLI_RUNTIME_DIR, { recursive: true, force: true });
  await fs.mkdir(CLI_RUNTIME_DIR, { recursive: true });
  const hasConfig = fssync.existsSync(CONFIG_DIR);
  if (hasConfig) {
    await fs.rm(CLI_SEEDS_DIR, { recursive: true, force: true });
    await fs.mkdir(CLI_SEEDS_DIR, { recursive: true });
  }

  // 3. 拷贝 standalone 整体结构
  console.log(`   - 拷贝 standalone 运行时...`);
  if (process.platform !== "win32") {
    // macOS / Linux 下使用系统原生 cp -R 保持软链接与嵌套依赖结构完全一致
    await execFileAsync("cp", ["-R", `${STANDALONE_DIR}/.`, CLI_RUNTIME_DIR]);
  } else {
    await copyDir(STANDALONE_DIR, CLI_RUNTIME_DIR);
  }

  // 4. 补齐 .next/static
  console.log(`   - 补齐 .next/static 静态资源...`);
  const targetStaticDir = path.join(CLI_RUNTIME_DIR, ".next", "static");
  if (process.platform !== "win32") {
    await fs.mkdir(targetStaticDir, { recursive: true });
    await execFileAsync("cp", ["-R", `${STATIC_DIR}/.`, targetStaticDir]);
  } else {
    await copyDir(STATIC_DIR, targetStaticDir);
  }

  // 5. 补齐 public
  if (fssync.existsSync(PUBLIC_DIR)) {
    console.log(`   - 补齐 public 资源...`);
    const targetPublicDir = path.join(CLI_RUNTIME_DIR, "public");
    if (process.platform !== "win32") {
      await fs.mkdir(targetPublicDir, { recursive: true });
      await execFileAsync("cp", ["-R", `${PUBLIC_DIR}/.`, targetPublicDir]);
    } else {
      await copyDir(PUBLIC_DIR, targetPublicDir);
    }
  }

  // 6. 补齐 Native 模块动态库 (如 DuckDB 的 libduckdb.dylib / .so / .dll)
  console.log(`   - 补齐 Native 共享动态库...`);
  const rootPnpm = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (fssync.existsSync(rootPnpm)) {
    const pnpmDirs = await fs.readdir(rootPnpm);
    for (const d of pnpmDirs) {
      if (d.includes("@duckdb+node-bindings")) {
        const sourcePkgDir = path.join(rootPnpm, d, "node_modules");
        const entries = await fs.readdir(sourcePkgDir).catch(() => []);
        for (const entry of entries) {
          if (entry.startsWith("@duckdb")) {
            const subEntries = await fs.readdir(path.join(sourcePkgDir, entry)).catch(() => []);
            for (const sub of subEntries) {
              const fullSource = path.join(sourcePkgDir, entry, sub);
              const targetDir = path.join(CLI_RUNTIME_DIR, "node_modules", ".pnpm", d, "node_modules", entry, sub);
              if (fssync.existsSync(targetDir)) {
                const files = await fs.readdir(fullSource).catch(() => []);
                for (const f of files) {
                  if (f.endsWith(".dylib") || f.endsWith(".so") || f.endsWith(".dll")) {
                    await fs.copyFile(path.join(fullSource, f), path.join(targetDir, f));
                    console.log(`     ✓ 补齐 ${f} -> ${path.relative(CLI_RUNTIME_DIR, targetDir)}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 6.5 白名单裁剪：Next standalone 在 monorepo 模式下镜像整个仓库根，
  // 直接拷贝会把本机用户数据（data/、designs/、config/）与全部源码带进
  // 发布 tarball（实测 233MB，且 sessions 属隐私数据）。只保留运行真正需要的部分。
  console.log(`   - 白名单裁剪 runtime（仅保留 server.js/package.json/.next/node_modules/public）...`);
  const RUNTIME_KEEP = new Set(["server.js", "package.json", ".next", "node_modules", "public"]);
  for (const entry of await fs.readdir(CLI_RUNTIME_DIR)) {
    if (!RUNTIME_KEEP.has(entry)) {
      await fs.rm(path.join(CLI_RUNTIME_DIR, entry), { recursive: true, force: true });
    }
  }

  // 6.6 禁止目录断言：runtime 里绝不允许出现本机数据/配置目录，
  // 这是发布前最后一道防数据泄露闸（发生在打包 tarball 之前）。
  for (const forbidden of ["data", "designs", "config"]) {
    if (fssync.existsSync(path.join(CLI_RUNTIME_DIR, forbidden))) {
      throw new Error(
        `组装校验失败：runtime 不应包含 ${forbidden}/（可能夹带了本机用户数据，禁止发布）`
      );
    }
  }

  // 7. 拷贝种子配置文件
  if (fssync.existsSync(CONFIG_DIR)) {
    console.log(`   - 拷贝种子配置模板...`);
    const files = await fs.readdir(CONFIG_DIR);
    for (const f of files) {
      if (f.endsWith(".json")) {
        await fs.copyFile(
          path.join(CONFIG_DIR, f),
          path.join(CLI_SEEDS_DIR, f)
        );
      }
    }
  }

  // 8. 清理 runtime 下的测试文件（避免无用体积与测试混淆）
  console.log(`   - 清理运行时冗余测试文件...`);
  if (process.platform !== "win32") {
    await execFileAsync("find", [CLI_RUNTIME_DIR, "-name", "*.test.*", "-delete"]).catch(() => {});
  }

  // 9. 回读断言校验
  const targetServerJs = path.join(CLI_RUNTIME_DIR, "server.js");
  if (!fssync.existsSync(targetServerJs)) {
    throw new Error(`组装校验失败：未找到目标 ${targetServerJs}`);
  }
  if (!fssync.existsSync(targetStaticDir)) {
    throw new Error(`组装校验失败：未找到目标 ${targetStaticDir}`);
  }

  console.log(`✅ [assemble-cli] 组装完成！产物位于 packages/ginkgo-cli/`);
}

main().catch((err) => {
  console.error(`❌ [assemble-cli] 组装失败:`, err.message || err);
  process.exit(1);
});
