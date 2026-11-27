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
];

/**
 * 等待 registry 传播：刚 publish 完的版本在 CDN 上可能还不可见（秒级），
 * 直接安装会得到 ETARGET/E404。这是发布后冒烟的唯一假失败源，故显式等待。
 */
async function waitForAvailability(names, version) {
  const timeoutMs = Number(process.env.SMOKE_WAIT_TIMEOUT_MS ?? 180_000);
  const intervalMs = Number(process.env.SMOKE_WAIT_INTERVAL_MS ?? 8_000);
  const deadline = Date.now() + timeoutMs;
  let pending = [...names];

  while (Date.now() < deadline) {
    const missing = [];
    for (const name of pending) {
      try {
        const { stdout } = await execFileAsync("npm", ["view", `${name}@${version}`, "version"]);
        if (stdout.trim() !== version) missing.push(name);
      } catch {
        missing.push(name);
      }
    }
    if (missing.length === 0) return;
    console.log(
      `  等待 registry 传播：${missing.length} 个包尚不可见（${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " …" : ""}）`
    );
    pending = missing;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `等待 registry 传播超时（${Math.round(timeoutMs / 1000)}s）：${pending.join(", ")} 未见 @${version}`
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
      { cwd: path.resolve(HERE, "..", dir), maxBuffer: 32 * 1024 * 1024 }
    );
    const out = stdout.trim().split("\n").pop();
    tarballs.push(path.isAbsolute(out) ? out : path.join(packDir, out));
  }
  return tarballs;
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

  try {
    await execFileAsync(
      "npm",
      ["install", ...installSpecs, "react@19", "react-dom@19", "--no-audit", "--no-fund"],
      { cwd: dir, maxBuffer: 64 * 1024 * 1024 }
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
  } catch (err) {
    console.log(String(err.stdout ?? "").trim());
    console.error("\n❌ 发布后冒烟存在失败项");
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
