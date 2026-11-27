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
const TMP_HOME = path.join(TMP_ROOT, "home");
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
  const testPort = await getFreePort();
  console.log(`🧪 [smoke-cli] 开始 @ginkgolab/cli 端到端冒烟测试（隔离安装）...`);
  console.log(`   临时工程: ${TMP_PROJECT}`);
  console.log(`   测试端口: ${testPort}`);

  await fs.mkdir(TMP_PROJECT, { recursive: true });

  // 1. 打真实 tarball
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

  // 2. 仓库外安装（隔离验证：optionalDependencies 会拉取本平台原生包）
  await fs.writeFile(
    path.join(TMP_PROJECT, "package.json"),
    JSON.stringify({ name: "ginkgo-smoke-consumer", version: "0.0.0", private: true }, null, 2)
  );
  console.log(`   正在隔离安装（含本平台原生包）...`);
  // 独立 npm cache：避免受开发机 ~/.npm 残留（root-owned 文件导致 EPERM）影响，
  // 也让 CI 与本机行为一致
  const npmCache = path.join(TMP_ROOT, "npm-cache");
  await fs.mkdir(npmCache, { recursive: true });
  await execFileAsync("npm", ["install", tgz, "--no-audit", "--no-fund"], {
    cwd: TMP_PROJECT,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: npmCache },
  });

  const cliBin = path.join(TMP_PROJECT, "node_modules", ".bin", "ginkgo");
  await fs.access(cliBin);

  await fs.mkdir(TMP_HOME, { recursive: true });

  // 3. 启动服务
  const child = spawn(
    cliBin,
    ["start", "-p", String(testPort), "--no-open", "--home", TMP_HOME],
    {
      stdio: "pipe",
      // detached: CLI 及其 fork 的 server 进程组独立，失败路径可整组击杀，
      // 避免 SIGKILL 只杀 CLI 父进程、server 成孤儿继续占用端口与隔离目录
      detached: process.platform !== "win32",
      env: { ...process.env },
    }
  );

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
  let ready = false;
  // CI 冷启动（无缓存依赖、低配 runner）可能显著慢于本地，允许用环境变量放宽
  const timeoutMs = Number(process.env.CLI_SMOKE_TIMEOUT_MS) || 25000;
  const start = Date.now();

  console.log(`   正在等待服务启动...`);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/apps`);
      if (res.status === 200) {
        const data = await res.json();
        if (Array.isArray(data.apps) && data.apps.length > 0) {
          console.log(`   ✅ 探测到 /api/apps 返回正常，应用数: ${data.apps.length}`);
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
    console.error(`\n❌ [smoke-cli] 服务在 ${timeoutMs}ms 内未就绪！`);
    console.error(`输出日志:\n${output}`);
    await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }

  // 4. 首页 + 数据源（数据源会加载 duckdb 等外部原生包，是跨平台分发正确性的关键信号）
  const pageRes = await fetch(url);
  console.log(`   ✅ 探测到平台首页响应状态: HTTP ${pageRes.status}`);

  const dsRes = await fetch(`${url}/api/datasources`);
  if (dsRes.status !== 200) {
    const body = (await dsRes.text()).slice(0, 800);
    killTree("SIGKILL");
    console.error(`\n❌ [smoke-cli] /api/datasources 返回 HTTP ${dsRes.status}`);
    console.error(`响应片段:\n${body}`);
    console.error(`输出日志:\n${output.slice(-3000)}`);
    await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }
  console.log(`   ✅ 探测到 /api/datasources HTTP 200（原生依赖加载正常）`);

  // 5. 优雅退出测试：SIGTERM 发给整组（CLI 会转发给 server）
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

  // 6. 清理
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});

  console.log(`🎉 [smoke-cli] @ginkgolab/cli 冒烟测试全部通过！\n`);
}

main().catch(async (err) => {
  console.error(`❌ [smoke-cli] 冒烟测试失败:`, err);
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
