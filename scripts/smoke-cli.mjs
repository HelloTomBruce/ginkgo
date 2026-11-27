#!/usr/bin/env node
/**
 * @ginkgolab/cli 启动冒烟测试（真实消费者视角）。
 *
 * 验证链路：
 *   1. pnpm pack 打出真实 tarball
 *   2. 在**仓库外**的临时工程 npm install 该 tarball —— 关键：隔离验证，
 *      避免仓库根 node_modules 兜底掩盖依赖缺失（曾因此漏掉「runtime 缺本平台
 *      原生二进制、macOS 上 duckdb 加载失败导致 /api/* 500」的分发缺陷）
 *   3. 用隔离 GINKGO_HOME 启动服务，探测首页 / /api/apps / /api/datasources
 *   4. SIGTERM 断言优雅退出，清理临时目录
 *
 * /api/datasources 必须探测：它加载 duckdb 等外部原生包，是跨平台分发是否
 * 正确的关键信号（只测首页会漏掉 native 缺失）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_PKG_DIR = path.join(REPO_ROOT, "packages", "ginkgo-cli");

const TMP_ROOT = path.join(
  os.tmpdir(),
  `ginkgo-smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
);

const TMP_PROJECT = path.join(TMP_ROOT, "project");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`🧪 [smoke-cli] 开始 @ginkgolab/cli 端到端冒烟测试（隔离安装）...`);
  console.log(`   临时工程: ${TMP_PROJECT}`);

  await fs.mkdir(TMP_PROJECT, { recursive: true });

  // 1. 打真实 tarball（两个场景共用）
  const packDir = path.join(TMP_ROOT, "pack");
  await fs.mkdir(packDir, { recursive: true });
  const { stdout: packOut } = await execFileAsync(
    "pnpm",
    ["pack", "--pack-destination", packDir],
    { cwd: CLI_PKG_DIR, maxBuffer: 512 * 1024 * 1024 }
  );
  const tgzName = packOut.trim().split("\n").pop();
  const tgz = path.isAbsolute(tgzName) ? tgzName : path.join(packDir, tgzName);
  console.log(`   已打包: ${path.basename(tgz)}`);

  // 2. 场景 A：默认安装（含本平台原生包）——功能完整
  await runScenario(tgz, {
    label: "默认安装（含本平台原生包）",
    omitOptional: false,
    requireDuckDB: true,
  });

  // 3. 场景 B：--omit=optional——原生二进制缺失时必须**降级**而非全站 500。
  //    这是 0.1.2 的真实故障模式（duckdb 顶层 import 拖垮所有 /api），
  //    改为懒加载后应只剩 duckdb 能力不可用，其余接口照常。
  await runScenario(tgz, {
    label: "--omit=optional（缺 native 应降级）",
    omitOptional: true,
    requireDuckDB: false,
  });

  console.log(`🎉 [smoke-cli] @ginkgolab/cli 冒烟测试全部通过！\n`);
}

/** 跑一次完整场景：隔离安装 → 启动 → 探测 → 优雅停机 */
async function runScenario(tgz, { label, omitOptional, requireDuckDB }) {
  const testPort = await getFreePort();
  const projectDir = path.join(TMP_ROOT, omitOptional ? "project-no-optional" : "project-default");
  const homeDir = path.join(TMP_ROOT, omitOptional ? "home-no-optional" : "home-default");

  console.log(`\n--- 场景：${label}（端口 ${testPort}）---`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "ginkgo-smoke-consumer", version: "0.0.0", private: true }, null, 2)
  );

  // 独立 npm cache：避免受开发机 ~/.npm 残留（root-owned 文件导致 EPERM）影响，
  // 也让 CI 与本机行为一致
  const npmCache = path.join(TMP_ROOT, "npm-cache");
  await fs.mkdir(npmCache, { recursive: true });
  const installArgs = ["install", tgz, "--no-audit", "--no-fund"];
  if (omitOptional) installArgs.push("--omit=optional");
  console.log(`   正在隔离安装${omitOptional ? "（--omit=optional）" : ""}...`);
  await execFileAsync("npm", installArgs, {
    cwd: projectDir,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: npmCache },
  });

  const cliBin = path.join(projectDir, "node_modules", ".bin", "ginkgo");
  await fs.access(cliBin);

  const child = spawn(cliBin, ["start", "-p", String(testPort), "--no-open", "--home", homeDir], {
    stdio: "pipe",
    // detached: CLI 及其 fork 的 server 进程组独立，失败路径可整组击杀，
    // 避免 SIGKILL 只杀 CLI 父进程、server 成孤儿继续占用端口与隔离目录
    detached: process.platform !== "win32",
    env: { ...process.env },
  });

  /** 击杀整个进程组（Windows 无负 pid 语义，退化为只杀 CLI 本体） */
  const killTree = (sig) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, sig);
        return;
      } catch {
        // 进程组可能已退出，回落到只杀本体
      }
    }
    child.kill(sig);
  };

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const url = `http://localhost:${testPort}`;
  // CI 冷启动（无缓存依赖、低配 runner）可能显著慢于本地，允许用环境变量放宽
  const timeoutMs = Number(process.env.CLI_SMOKE_TIMEOUT_MS) || 25000;
  let ready = false;
  const start = Date.now();

  console.log(`   正在等待服务启动...`);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/apps`);
      if (res.status === 200) {
        const data = await res.json();
        if (Array.isArray(data.apps) && data.apps.length > 0) {
          console.log(`   ✅ /api/apps 正常，应用数: ${data.apps.length}`);
          ready = true;
          break;
        }
      }
    } catch {
      // 等待下一次重试
    }
    await sleep(500);
  }

  if (!ready) {
    killTree("SIGKILL");
    console.error(`\n❌ [smoke-cli] ${label}：服务在 ${timeoutMs}ms 内未就绪！`);
    console.error(`输出日志:\n${output}`);
    throw new Error(`${label} 启动失败`);
  }

  // 首页
  const pageRes = await fetch(url);
  if (pageRes.status !== 200) {
    killTree("SIGKILL");
    throw new Error(`${label}：首页返回 HTTP ${pageRes.status}`);
  }
  console.log(`   ✅ 首页 HTTP 200`);

  // 数据源接口：默认场景应加载 duckdb 等原生包；--omit=optional 场景必须降级为 200
  const dsRes = await fetch(`${url}/api/datasources`);
  if (dsRes.status !== 200) {
    const body = (await dsRes.text()).slice(0, 800);
    killTree("SIGKILL");
    console.error(`\n❌ [smoke-cli] ${label}：/api/datasources 返回 HTTP ${dsRes.status}`);
    console.error(`响应片段:\n${body}`);
    console.error(`输出日志:\n${output.slice(-3000)}`);
    throw new Error(`${label}：/api/datasources 异常`);
  }
  const dsBody = await dsRes.text();
  if (requireDuckDB && /DuckDB 原生模块不可用/.test(dsBody)) {
    killTree("SIGKILL");
    throw new Error(`${label}：默认安装下 DuckDB 应可用，但报告原生模块不可用`);
  }
  console.log(
    `   ✅ /api/datasources HTTP 200${omitOptional ? "（缺 native 已降级，未拖垮接口）" : "（原生依赖加载正常）"}`
  );

  // 优雅退出
  console.log(`   正在发送 SIGTERM 请求优雅停机...`);
  killTree("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      killTree("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      console.log(`   ✅ 子进程已退出 (code=${code}, signal=${signal})`);
      resolve();
    });
  });
}

main().catch(async (err) => {
  console.error(`❌ [smoke-cli] 冒烟测试失败:`, err);
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
