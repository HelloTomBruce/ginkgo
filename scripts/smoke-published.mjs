#!/usr/bin/env node
/**
 * 发布后冒烟：在临时工程里从**公网 registry** 安装整条链，验证真实消费者视角。
 *
 * 为什么必须做：本地 tarball 冒烟发现不了"发上去少了文件 / 出口指向不存在路径 /
 * 依赖版本没发"。0.1.0 发布时就出现过两个包传播未就绪导致的 E404。
 *
 * 用法：
 *   node scripts/smoke-published.mjs --version 0.1.1   # 验证已发布版本（发布后）
 *   node scripts/smoke-published.mjs --from-pack       # 验证本地待发布产物（发布前）
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const PACKAGE_DIRS = [
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
  // CLI 是 bin 型大包：不 import、只验 bin 可执行（见 verifyCli）
  "packages/ginkgo-cli",
];

const PACKAGES = [
  "@ginkgolab/app-sdk",
  "@ginkgolab/models",
  "@ginkgolab/chart-spec",
  "@ginkgolab/datasources",
  "@ginkgolab/components",
  "@ginkgolab/harness-core",
  "@ginkgolab/sandbox",
  "@ginkgolab/llm",
  "@ginkgolab/app-analytics",
  "@ginkgolab/app-design",
  "@ginkgolab/cli",
];

const CLI_PACKAGE = "@ginkgolab/cli";

/** 包名 + 版本 → registry tarball 直链 */
function tarballUrl(name, version) {
  const registry = (process.env.SMOKE_REGISTRY || "https://registry.npmjs.org").replace(/\/$/, "");
  const bare = name.split("/").pop();
  return `${registry}/${name}/-/${bare}-${version}.tgz`;
}

/**
 * 等待 registry 就绪：以 **tarball 直链 200** 为准，而不是 `npm view`。
 *
 * 为什么：npm 对大包（CLI 约 60MB / 1.6 万文件）有 validating 阶段——上传成功、
 * publish 回执 ✅，但 packument 元数据要等验证完才更新，期间 `npm view` 查不到、
 * tarball 也 404。用 `npm view` 判断会把「还在验证」误判为「没发上去」，
 * 进而重跑发布（重跑又会因版本已存在而假失败）。tarball 直链 200 是唯一可靠信号。
 */
async function waitForAvailability(names, version) {
  const timeoutMs = Number(process.env.SMOKE_WAIT_TIMEOUT_MS ?? 300_000);
  const intervalMs = Number(process.env.SMOKE_WAIT_INTERVAL_MS ?? 8_000);
  const deadline = Date.now() + timeoutMs;
  let pending = [...names];

  while (Date.now() < deadline) {
    const missing = [];
    for (const name of pending) {
      try {
        const res = await fetch(tarballUrl(name, version), { method: "HEAD" });
        if (res.status !== 200) missing.push(name);
      } catch {
        missing.push(name);
      }
    }
    if (missing.length === 0) return;
    console.log(
      `  等待 registry 就绪（已等 ${Math.round((Date.now() - (deadline - timeoutMs)) / 1000)}s）：` +
        `${missing.length} 个包尚不可见（${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " …" : ""}）`
    );
    pending = missing;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // 大包 validating 可能持续较久：这通常是"上传成功但验证未完成"，不是发布失败。
  throw new Error(
    `等待 registry 就绪超时（${Math.round(timeoutMs / 1000)}s）：${pending.join(", ")} 未见 @${version} 的 tarball。\n` +
      "  若 publish 步骤已成功，说明只是 npm validating/传播未完成（大包尤其慢）；稍后重跑即可（脚本会跳过已发布版本）。\n" +
      "  可通过 SMOKE_WAIT_TIMEOUT_MS 调大等待上限。"
  );
}

async function resolveVersion() {
  const idx = process.argv.indexOf("--version");
  if (idx > -1) return process.argv[idx + 1];
  const pkg = JSON.parse(
    await fs.readFile(path.resolve(HERE, "../packages/ginkgo-app-sdk/package.json"), "utf-8")
  );
  return pkg.version;
}

/** 打包本地产物并用 tarball 安装（发布前的同一套检查） */
async function packAll(packDir) {
  const tarballs = [];
  for (const dir of PACKAGE_DIRS) {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", packDir],
      // CLI 的 runtime 有 1.6 万文件，pnpm pack 会把完整清单打到 stdout，32MB 会溢出
      { cwd: path.resolve(HERE, "..", dir), maxBuffer: 512 * 1024 * 1024 }
    );
    const out = stdout.trim().split("\n").pop();
    tarballs.push(path.isAbsolute(out) ? out : path.join(packDir, out));
  }
  return tarballs;
}

/**
 * 验证 CLI 分发包：bin 可执行 + 版本正确 + 本平台原生依赖已装上。
 *
 * 这是此前冒烟的真实盲区——脚本只 import 库包出口，CLI 不在清单里，
 * 于是「发布后冒烟全绿」并不能证明 CLI 装得上、跑得起来。
 */
async function verifyCli(dir, version) {
  const cliBin = path.join(dir, "node_modules", ".bin", "ginkgo");
  try {
    await fs.access(cliBin);
  } catch {
    throw new Error(`${CLI_PACKAGE}：安装后未生成 bin（node_modules/.bin/ginkgo 不存在）`);
  }

  const { stdout } = await execFileAsync(cliBin, ["version"], { maxBuffer: 8 * 1024 * 1024 });
  const printed = stdout.trim();
  // --from-pack 模式没有可比对的发布版本号，只要求能打印版本
  if (version !== "(local pack)" && printed !== `v${version}`) {
    throw new Error(`${CLI_PACKAGE}：ginkgo version 输出 ${printed}，期望 v${version}`);
  }
  if (!/^v\d+\.\d+\.\d+/.test(printed)) {
    throw new Error(`${CLI_PACKAGE}：ginkgo version 输出异常：${printed}`);
  }
  console.log(`  ✅ ${CLI_PACKAGE} bin 可执行（${printed}）`);

  // 原生依赖按平台分发：至少本平台的 duckdb 二进制应被装上，否则 duckdb 能力不可用
  const platformSuffix = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
  const duckdbNative = path.join(dir, "node_modules", "@duckdb", `node-bindings-${platformSuffix}`);
  if (!(await pathExists(duckdbNative))) {
    throw new Error(
      `${CLI_PACKAGE}：本平台原生依赖未安装（缺 @duckdb/node-bindings-${platformSuffix}），` +
        `DuckDB 能力将不可用——检查 optionalDependencies 是否覆盖该平台`
    );
  }
  console.log(`  ✅ ${CLI_PACKAGE} 本平台原生依赖就绪（@duckdb/node-bindings-${platformSuffix}）`);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const fromPack = process.argv.includes("--from-pack");
  const version = fromPack ? "(local pack)" : await resolveVersion();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-published-"));
  console.log(`临时工程：${dir}`);
  console.log(`安装 @ginkgolab/*@${version} + react@19 …`);

  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "smoke", private: true, type: "module" }, null, 2)
  );

  let installSpecs;
  if (fromPack) {
    const packDir = path.join(dir, "packs");
    await fs.mkdir(packDir, { recursive: true });
    installSpecs = await packAll(packDir);
    console.log(`已打包 ${installSpecs.length} 个本地 tarball`);
  } else {
    await waitForAvailability(PACKAGES, version);
    installSpecs = PACKAGES.map((n) => `${n}@${version}`);
  }

  // 独立 npm cache：避免受开发机 ~/.npm 残留（root-owned 文件导致 EPERM）影响，
  // 也让 CI 与本机行为一致
  const npmCache = path.join(dir, "npm-cache");
  await fs.mkdir(npmCache, { recursive: true });

  try {
    await execFileAsync(
      "npm",
      ["install", ...installSpecs, "react@19", "react-dom@19", "--no-audit", "--no-fund"],
      { cwd: dir, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, npm_config_cache: npmCache } }
    );
  } catch (err) {
    console.error("安装失败（某包未发布或 registry 传播未就绪）：");
    console.error(String(err.stderr || err.stdout || err.message).slice(-2500));
    process.exit(1);
  }

  const child = path.join(dir, "smoke.mjs");
  await fs.copyFile(path.join(HERE, "smoke-published.child.mjs"), child);

  try {
    const { stdout } = await execFileAsync("node", [child], { cwd: dir, maxBuffer: 32 * 1024 * 1024 });
    console.log(stdout.trim());
    // 库包出口验证通过后再验 CLI（bin 型，不走 import）
    await verifyCli(dir, version);
  } catch (err) {
    console.log(String(err.stdout ?? "").trim());
    console.error("\n❌ 发布后冒烟存在失败项");
    console.error(String(err.message ?? err));
    process.exit(1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n✅ 冒烟通过（@ginkgolab/* ${version}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
