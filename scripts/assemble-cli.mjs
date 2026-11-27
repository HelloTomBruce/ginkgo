#!/usr/bin/env node
/**
 * 组装 @ginkgolab/cli 产物脚本。
 *
 * 职责：
 *   1. 将 Next.js build 的 .next/standalone 搬运至 packages/ginkgo-cli/runtime
 *   2. 按照 Next.js 生产约定补全 .next/static 与 public
 *   3. 以 pnpm hoisted 布局重建 node_modules（全实体、零软链、经典解析）
 *   4. 提取默认种子配置文件至 packages/ginkgo-cli/seeds
 *   5. 做完整性校验（server.js、static、native 库、无软链、无数据目录混入）
 *
 * 为什么必须重建 node_modules：standalone 的 node_modules 是 pnpm 布局——
 * 顶层包是指向 .pnpm 店内的软链，传递依赖只存在于各店面条目的私有
 * node_modules 里。npm registry 拒收含软链的 tarball（415 "Symbolic link
 * is not allowed"），而简单物化软链会改变 Node 的 realpath 解析基线导致
 * 模块解析断裂（顶层实体的 next 再也找不到只存在于店内的 @swc/helpers）。
 * hoisted 布局（npm 式平铺实体文件）是唯一同时满足「可上传」与「可解析」
 * 的形态。版本从店内 package.json 逐包读取精确固定，避免重新解析漂移。
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
      // 符号链接解引用为实体拷贝（断链跳过）
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

async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * 从 standalone 的 pnpm 布局 node_modules 收集全部依赖的精确版本。
 * 必须在删除 node_modules 之前调用。顶层（应用直接依赖）优先，店内
 * （传递依赖）补齐；同名多版本时记录依赖边（用于按消费者物化嵌套副本，
 * 平铺只能留一个版本，另一个按 pnpm 原解析关系嵌进对应消费者私有 node_modules）。
 */
async function collectPinnedDeps(standaloneNm) {
  const pinned = {};
  const conflicts = [];
  const edges = [];
  const storePackages = new Set();

  const record = (name, version) => {
    if (pinned[name] && pinned[name] !== version) {
      conflicts.push(`${name}: ${pinned[name]} vs ${version}（平铺保留 ${pinned[name]}，另一版本按依赖边嵌套）`);
      return;
    }
    pinned[name] = version;
  };

  const readPkg = async (dir) => {
    const manifest = await readJsonSafe(path.join(dir, "package.json"));
    if (manifest?.name && manifest?.version) {
      record(manifest.name, manifest.version);
      storePackages.add(manifest.name);
    }
    return manifest;
  };

  /** 收集一条软链依赖边：消费者店内条目 → 目标包精确版本 */
  const readEdge = async (consumerName, linkPath) => {
    const real = await fs.realpath(linkPath).catch(() => null);
    if (!real) return;
    const manifest = await readJsonSafe(path.join(real, "package.json"));
    if (manifest?.name && manifest?.version) {
      edges.push({ consumerName, targetReal: real, depName: manifest.name, depVersion: manifest.version });
    }
  };

  for (const entry of await fs.readdir(standaloneNm, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(standaloneNm, entry.name);
    if (entry.name.startsWith("@")) {
      // scoped 容器：逐个读子包
      for (const sub of await fs.readdir(full, { withFileTypes: true }).catch(() => [])) {
        await readPkg(path.join(full, sub.name));
      }
    } else {
      await readPkg(full);
    }
  }

  const pnpmStoreDir = path.join(standaloneNm, ".pnpm");
  if (fssync.existsSync(pnpmStoreDir)) {
    for (const storeEntry of await fs.readdir(pnpmStoreDir)) {
      if (storeEntry === "node_modules") continue;
      const entryNm = path.join(pnpmStoreDir, storeEntry, "node_modules");
      const subs = await fs.readdir(entryNm, { withFileTypes: true }).catch(() => []);
      // 该店面条目的消费者包（真实目录，可能是 scoped 容器下的子包）
      let consumerName = null;
      for (const sub of subs) {
        if (sub.isSymbolicLink() || sub.name.startsWith("@")) continue;
        const manifest = await readJsonSafe(path.join(entryNm, sub.name, "package.json"));
        if (manifest?.name) {
          consumerName = manifest.name;
          break;
        }
      }
      for (const sub of subs) {
        const subPath = path.join(entryNm, sub.name);
        if (sub.isSymbolicLink()) {
          await readEdge(consumerName, subPath);
          continue;
        }
        if (sub.name.startsWith("@")) {
          // scoped 容器：下钻子包（此前漏掉导致 @duckdb/*、@img/sharp-* 全部丢失）
          for (const inner of await fs.readdir(subPath, { withFileTypes: true }).catch(() => [])) {
            const innerPath = path.join(subPath, inner.name);
            if (inner.isSymbolicLink()) {
              await readEdge(consumerName, innerPath);
            } else {
              await readPkg(innerPath);
            }
          }
          continue;
        }
        await readPkg(subPath);
      }
    }
  }

  const missing = [...storePackages].filter((name) => !pinned[name]);
  if (missing.length > 0) {
    throw new Error(`店内包未被收集到精确版本: ${missing.join(", ")}`);
  }

  return { pinned, conflicts, edges };
}

/**
 * 平铺安装后按依赖边补嵌套副本：当某消费者的依赖版本与平铺根版本不一致时，
 * 把店内该精确版本物化到消费者的私有 node_modules（等价 npm 嵌套语义）。
 */
async function nestConflictingDeps(runtimeNm, edges, pinned) {
  const done = new Set();
  let nested = 0;
  for (const edge of edges) {
    if (pinned[edge.depName] === edge.depVersion) continue;
    const key = `${edge.consumerName}@${edge.depName}@${edge.depVersion}`;
    if (done.has(key)) continue;
    done.add(key);
    const consumerDir = path.join(runtimeNm, ...edge.consumerName.split("/"));
    if (!fssync.existsSync(consumerDir)) {
      console.warn(`     ⚠️ 嵌套跳过：未找到消费者 ${edge.consumerName} 的安装目录`);
      continue;
    }
    const dest = path.join(consumerDir, "node_modules", ...edge.depName.split("/"));
    await fs.rm(dest, { recursive: true, force: true });
    await copyDir(edge.targetReal, dest);
    nested++;
    console.log(
      `     ✓ 嵌套 ${edge.depName}@${edge.depVersion} -> ${edge.consumerName}/node_modules（平铺根为 ${pinned[edge.depName]}）`
    );
  }
  return nested;
}

/**
 * 剔除平台原生包（@duckdb/node-bindings-<platform>、@img/sharp-<platform>、
 * @img/sharp-libvips-<platform>）。
 *
 * 为什么要剔除：这些包按平台分发且单个 60~100MB，若打进主包只能包含组装机
 * 所在平台（CI = linux-x64），macOS/Windows 用户装上会因缺 native 二进制而
 * 加载失败。改为由 CLI 包 package.json 的 optionalDependencies 声明，
 * npm 安装时按目标平台自动取对应包（esbuild / sharp 同款做法），
 * 装在安装根 node_modules 下，runtime 内的 require 可沿目录向上解析到。
 */
const PLATFORM_PKG_PATTERNS = [
  /^@duckdb[+/]node-bindings-(darwin|linux|win32)/,
  /^@img[+/]sharp-(darwin|linux|win32)/,
  /^@img[+/]sharp-libvips-/,
];

function isPlatformPackageName(name) {
  return PLATFORM_PKG_PATTERNS.some((re) => re.test(name));
}

async function prunePlatformNativePackages(runtimeDir) {
  const removed = [];
  const scopeDirs = ["@duckdb", "@img"];
  for (const scope of scopeDirs) {
    const dir = path.join(runtimeDir, "node_modules", scope);
    if (!fssync.existsSync(dir)) continue;
    for (const entry of await fs.readdir(dir)) {
      const fullName = `${scope}/${entry}`;
      if (isPlatformPackageName(fullName)) {
        await fs.rm(path.join(dir, entry), { recursive: true, force: true });
        removed.push(fullName);
      }
    }
  }
  return removed;
}
async function countSymlinks(dir) {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) count++;
    else if (entry.isDirectory()) count += await countSymlinks(full);
  }
  return count;
}

/**
 * 物化 runtime 内残留软链（hoisted 重装后仅剩 .next/node_modules 里
 * Next 对 serverExternalPackages 的装载链接）。链接目标已在重建时删除，
 * 按「runtime → standalone 源树」前缀重映射后取实体拷贝；源树找不到则报错。
 */
async function materializeResidualSymlinks(runtimeDir) {
  const remapToStandalone = (p) =>
    path.join(STANDALONE_DIR, path.relative(runtimeDir, p));

  let replaced = 0;
  async function walk(d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) {
        const raw = await fs.readlink(full);
        const absTarget = path.resolve(path.dirname(full), raw);
        const source = remapToStandalone(absTarget);
        if (!fssync.existsSync(source)) {
          throw new Error(
            `物化软链失败：${full} 的目标在 standalone 源树中不存在（${source}）`
          );
        }
        await fs.rm(full, { force: true, recursive: true });
        const stat = await fs.stat(source);
        if (stat.isDirectory()) {
          await copyDir(source, full);
        } else {
          await fs.copyFile(source, full);
        }
        replaced++;
        console.log(`     ✓ 物化 ${path.relative(runtimeDir, full)}`);
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  }
  await walk(runtimeDir);
  return replaced;
}

/**
 * 以 pnpm hoisted 布局重建 runtime/node_modules：
 * 版本从旧店内精确收集并钉死 → 删除旧布局 → 平铺实体重装。
 */
async function rebuildNodeModulesHoisted(runtimeDir) {
  const nm = path.join(runtimeDir, "node_modules");
  // 必须读 standalone 源树收集：runtime 副本的 node_modules 马上会被删除，
  // 依赖边上记录的 realpath 若指向 runtime 会悬空（standalone 源树恒等且不动）
  const { pinned, conflicts, edges } = await collectPinnedDeps(path.join(STANDALONE_DIR, "node_modules"));

  if (!pinned.next || !pinned.react) {
    throw new Error("未能从 standalone node_modules 收集到 next/react 精确版本，中断重建");
  }
  for (const c of conflicts) console.warn(`     ⚠️ 版本冲突: ${c}`);
  console.log(`     ✓ 收集到 ${Object.keys(pinned).length} 个依赖的精确版本`);

  await fs.writeFile(
    path.join(runtimeDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ginkgo-standalone-runtime",
        version: "0.0.0",
        private: true,
        // 注：原生依赖（duckdb/sharp）的平台包在安装后由 prunePlatformNativePackages
        // 剔除，改由 CLI 包 optionalDependencies 按用户平台分发，故此处无需
        // supportedArchitectures（它只影响组装机自身能装到哪些平台的可选依赖）。
        dependencies: Object.fromEntries(Object.entries(pinned).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2
    )}\n`
  );

  await fs.rm(nm, { recursive: true, force: true });
  console.log(`     ✓ 以 hoisted 布局重装（--prefer-offline 优先本地 store）...`);
  await execFileAsync(
    "pnpm",
    [
      "install",
      "--prod",
      "--node-linker=hoisted",
      "--ignore-scripts",
      "--ignore-workspace",
      "--prefer-offline",
      "--lockfile=false",
      "--reporter=append-only",
    ],
    { cwd: runtimeDir, maxBuffer: 32 * 1024 * 1024 }
  );

  const nested = await nestConflictingDeps(nm, edges, pinned);
  if (nested > 0) console.log(`     ✓ 按依赖边嵌套了 ${nested} 个冲突版本的私有副本`);

  // 剔除平台原生包：由 CLI 包 optionalDependencies 在用户安装时按平台分发，
  // 主包若只含组装机平台会让其它平台用户缺 native 二进制
  const prunedNative = await prunePlatformNativePackages(runtimeDir);
  if (prunedNative.length > 0) {
    console.log(`     ✓ 剔除平台原生包 ${prunedNative.length} 个（改由 optionalDependencies 分发）`);
  }

  // hoisted 重装后 .next/node_modules 里仍残留 Next 对 serverExternalPackages
  // 的装载软链（目标 .pnpm 已删），从 standalone 源树取实体副本补上
  const residual = await materializeResidualSymlinks(runtimeDir);
  if (residual > 0) console.log(`     ✓ 物化了 ${residual} 个残留软链`);
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
    // macOS / Linux 下使用系统原生 cp -R 保持依赖结构完全一致
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

  // 6. 白名单裁剪：Next standalone 在 monorepo 模式下镜像整个仓库根，
  // 直接拷贝会把本机用户数据（data/、designs/、config/）与全部源码带进
  // 发布 tarball（实测 233MB，且 sessions 属隐私数据）。只保留运行真正需要的部分。
  console.log(`   - 白名单裁剪 runtime（仅保留 server.js/package.json/.next/node_modules/public）...`);
  const RUNTIME_KEEP = new Set(["server.js", "package.json", ".next", "node_modules", "public"]);
  for (const entry of await fs.readdir(CLI_RUNTIME_DIR)) {
    if (!RUNTIME_KEEP.has(entry)) {
      await fs.rm(path.join(CLI_RUNTIME_DIR, entry), { recursive: true, force: true });
    }
  }

  // 7. 以 hoisted 布局重建 node_modules（全实体、零软链，registry 可上传、
  // Node 经典解析可用）。旧 pnpm 布局的软链会让 publish 被 415 拒收，
  // 简单物化软链又会破坏 realpath 解析，故整体重建。
  console.log(`   - 重建 node_modules（pnpm hoisted 布局）...`);
  await rebuildNodeModulesHoisted(CLI_RUNTIME_DIR);

  // 8. 禁止目录断言：runtime 里绝不允许出现本机数据/配置目录，
  // 这是发布前最后一道防数据泄露闸（发生在打包 tarball 之前）。
  for (const forbidden of ["data", "designs", "config"]) {
    if (fssync.existsSync(path.join(CLI_RUNTIME_DIR, forbidden))) {
      throw new Error(
        `组装校验失败：runtime 不应包含 ${forbidden}/（可能夹带了本机用户数据，禁止发布）`
      );
    }
  }

  // 9. 拷贝种子配置文件
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

  // 10. 清理 runtime 下的测试文件（避免无用体积与测试混淆）
  console.log(`   - 清理运行时冗余测试文件...`);
  if (process.platform !== "win32") {
    await execFileAsync("find", [CLI_RUNTIME_DIR, "-name", "*.test.*", "-delete"]).catch(() => {});
  }

  // 11. 回读断言校验
  const targetServerJs = path.join(CLI_RUNTIME_DIR, "server.js");
  if (!fssync.existsSync(targetServerJs)) {
    throw new Error(`组装校验失败：未找到目标 ${targetServerJs}`);
  }
  if (!fssync.existsSync(targetStaticDir)) {
    throw new Error(`组装校验失败：未找到目标 ${targetStaticDir}`);
  }
  // 重建后的 runtime 必须零软链（registry 硬约束），含 .next/node_modules
  const links = await countSymlinks(CLI_RUNTIME_DIR);
  if (links > 0) {
    throw new Error(`组装校验失败：node_modules 仍含 ${links} 个软链，npm registry 会拒收 tarball`);
  }
  // 平台原生包必须已剔除（改由 CLI 包 optionalDependencies 分发）；
  // 残留会让主包只含组装机平台二进制，其它平台用户加载失败
  const leftoverNative = [];
  for (const scope of ["@duckdb", "@img"]) {
    const dir = path.join(CLI_RUNTIME_DIR, "node_modules", scope);
    if (!fssync.existsSync(dir)) continue;
    for (const entry of await fs.readdir(dir)) {
      if (isPlatformPackageName(`${scope}/${entry}`)) leftoverNative.push(`${scope}/${entry}`);
    }
  }
  if (leftoverNative.length > 0) {
    throw new Error(
      `组装校验失败：runtime 仍含平台原生包 ${leftoverNative.join(", ")}（应改由 optionalDependencies 分发）`
    );
  }
  // 纯 JS 侧必须仍在（否则数据源功能缺失）
  for (const required of ["@duckdb/node-api", "@duckdb/node-bindings", "sharp"]) {
    if (!fssync.existsSync(path.join(CLI_RUNTIME_DIR, "node_modules", required))) {
      throw new Error(`组装校验失败：runtime 缺少 ${required}（数据源/图片能力将不可用）`);
    }
  }
  console.log(`     ✓ 平台原生包已剔除，纯 JS 侧完整（native 由 optionalDependencies 分发）`);

  console.log(`✅ [assemble-cli] 组装完成！产物位于 packages/ginkgo-cli/`);
}

main().catch((err) => {
  console.error(`❌ [assemble-cli] 组装失败:`, err.message || err);
  process.exit(1);
});
