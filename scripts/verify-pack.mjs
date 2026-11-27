#!/usr/bin/env node
/**
 * 发布前的打包校验（本地与 CI 共用）。
 *
 * 为什么需要：`pnpm publish` 有若干"只在发布那一刻才失败"的坑，例如
 * `private: true` 被拒、publishConfig 的出口指向了未打进 tarball 的文件、
 * 忘记构建导致 dist 缺失。这些用 `pnpm verify` 都发现不了——本脚本把它们变成前置断言。
 *
 * 用法：node scripts/verify-pack.mjs [--keep]
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/** 刻意不发布根入口的包（根入口内联客户端插槽组件，只能作客户端件） */
const ROOTLESS = new Set([
  "@ginkgolab/app-analytics",
  "@ginkgolab/app-design",
  "@ginkgolab/app-general",
]);

const failures = [];
const fail = (pkg, msg) => failures.push(`${pkg}: ${msg}`);

/** 读取 tarball 内的 package.json、文件清单与符号链接列表 */
async function inspectTarball(tgz, cwd) {
  const [{ stdout: listing }, { stdout: verbose }, { stdout: manifest }] = await Promise.all([
    execFileAsync("tar", ["-tzf", tgz], { cwd, maxBuffer: 128 * 1024 * 1024 }),
    // verbose 格式权限位首字符：l=软链。npm registry 拒收含软链的 tarball（415）
    execFileAsync("tar", ["-tvzf", tgz], { cwd, maxBuffer: 128 * 1024 * 1024 }),
    execFileAsync("tar", ["-xzOf", tgz, "package/package.json"], {
      cwd,
      maxBuffer: 128 * 1024 * 1024,
    }),
  ]);
  const symlinks = verbose
    .split("\n")
    .filter((line) => line.startsWith("l"))
    .map((line) => line.split(" -> ")[1] ?? line);
  return {
    files: listing.split("\n").filter(Boolean).map((f) => f.replace(/^package\//, "")),
    symlinks,
    manifest: JSON.parse(manifest),
  };
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "verify-pack-"));
  try {
    for (const pkgDir of PACKAGES) {
      const abs = path.resolve(pkgDir);
      let tgzName;
      try {
        const { stdout } = await execFileAsync(
          "pnpm",
          ["pack", "--pack-destination", tmp],
          // CLI 包 runtime 含数万文件，pnpm pack 会把完整文件清单打到 stdout
          { cwd: abs, maxBuffer: 512 * 1024 * 1024 }
        );
        tgzName = stdout.trim().split("\n").pop();
      } catch (err) {
        fail(pkgDir, `pnpm pack 失败: ${String(err).slice(0, 200)}`);
        continue;
      }

      // pnpm 可能输出绝对路径（--pack-destination 为绝对路径时）
      const tgz = path.isAbsolute(tgzName) ? tgzName : path.join(tmp, tgzName);
      const { files, symlinks, manifest } = await inspectTarball(tgz, abs);
      const name = manifest.name ?? pkgDir;
      const fileSet = new Set(files);

      // npm registry 对含符号链接的 tarball 直接 415 拒收，必须在本地拦住
      if (symlinks.length > 0) {
        fail(
          name,
          `tarball 含 ${symlinks.length} 个符号链接，npm registry 会拒收（如 ${symlinks[0]}）；` +
            `需在打包前物化软链（scripts/assemble-cli.mjs 已处理 runtime，其余包检查构建产物）`
        );
      }

      if (manifest.private) fail(name, "含 private: true，npm 会拒绝发布");
      if (!manifest.license) fail(name, "缺少 license");
      if (!manifest.engines?.node) fail(name, "缺少 engines.node");
      if (!fileSet.has("README.md")) fail(name, "tarball 缺 README.md");
      if (!fileSet.has("LICENSE")) fail(name, "tarball 缺 LICENSE");

      if (manifest.bin) {
        // npm 规范允许 bin 为字符串（单命令包，命令名取包名末段）；
        // Object.entries 对字符串会按字符迭代产生误报，先归一化为对象。
        const binMap =
          typeof manifest.bin === "string"
            ? { [String(manifest.name ?? "").split("/").pop() || "cli"]: manifest.bin }
            : manifest.bin;
        // CLI 工具包：校验 bin 入口文件是否存在
        for (const [cmd, binTarget] of Object.entries(binMap)) {
          const rel = String(binTarget).replace(/^\.\//, "");
          if (!fileSet.has(rel)) fail(name, `bin ${cmd} 指向 ${rel}，但 tarball 内不存在`);
        }
        // 声明了 runtime 目录的分发包：runtime/server.js 与 seeds 必须真实在 tarball 内。
        // runtime 由 scripts/assemble-cli.mjs 组装且被 gitignore——CI 干净 checkout 上
        // 不跑 assemble 就发布，会打出一个只有 bin 壳的坏包，这里作为硬闸拦住。
        if (Array.isArray(manifest.files) && manifest.files.includes("runtime")) {
          if (!fileSet.has("runtime/server.js")) {
            fail(name, "tarball 缺 runtime/server.js（发布前需跑 pnpm cli:assemble）");
          }
          const hasSeeds = [...fileSet].some(
            (f) => f.startsWith("seeds/") && f.endsWith(".json")
          );
          if (!hasSeeds) fail(name, "tarball 缺少 seeds/*.json 种子配置");
        }
      } else {
        // 库包：校验 exports 规范
        if (!manifest.exports || typeof manifest.exports !== "object") {
          fail(name, "tarball 缺少 exports（publishConfig 未生效？）");
        }

        // 每个发布出口的目标必须真实存在于 tarball 内
        for (const [sub, target] of Object.entries(manifest.exports ?? {})) {
          const js = typeof target === "string" ? target : target.import;
          const rel = js.replace(/^\.\//, "");
          if (!fileSet.has(rel)) fail(name, `出口 ${sub} 指向 ${rel}，但 tarball 内不存在`);
          const dts = typeof target === "string" ? null : target.types;
          if (dts && !fileSet.has(dts.replace(/^\.\//, ""))) {
            fail(name, `出口 ${sub} 的类型 ${dts} 不存在`);
          }
        }

        // 应用包刻意不发布根入口（根入口内联客户端组件），其余包必须有 "."
        const isApp = ROOTLESS.has(name);
        if (isApp && manifest.exports?.["."]) {
          fail(name, '应用包不应暴露根入口 "."（会带来 RSC 边界问题）');
        }
        if (!isApp && !manifest.exports?.["."]) {
          fail(name, '缺少根出口 "."');
        }
      }
      if (manifest.main && !fileSet.has(manifest.main.replace(/^\.\//, ""))) {
        fail(name, `main 指向 ${manifest.main}，但 tarball 内不存在`);
      }

      if (!failures.some((f) => f.startsWith(name))) {
        console.log(
          `✅ ${name.padEnd(26)} v${manifest.version} 出口 ${Object.keys(manifest.exports ?? {}).length} 个，${files.length} 个文件`
        );
      }
    }
  } finally {
    if (!process.argv.includes("--keep")) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    } else {
      console.log(`\n[--keep] tarball 保留在 ${tmp}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n❌ 打包校验失败 ${failures.length} 项：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n全部打包校验通过。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
