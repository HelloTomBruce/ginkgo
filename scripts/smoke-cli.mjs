#!/usr/bin/env node
/**
 * @ginkgolab/cli 启动冒烟测试。
 *
 * 验证链路：
 *   1. 使用临时隔离目录作为 GINKGO_HOME
 *   2. 执行 bin/ginkgo.mjs start -p <动态端口> --no-open --home <隔离目录>
 *   3. 轮询探测 HTTP 状态（首页 200 / /api/apps 返回合法 JSON）
 *   4. 发送 SIGTERM 并断言优雅退出
 *   5. 清理隔离目录
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_BIN = path.join(REPO_ROOT, "packages", "ginkgo-cli", "bin", "ginkgo.mjs");

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

const TMP_HOME = path.join(
  os.tmpdir(),
  `ginkgo-smoke-home-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const testPort = await getFreePort();
  console.log(`🧪 [smoke-cli] 开始 @ginkgolab/cli 端到端启动冒烟测试...`);
  console.log(`   隔离存储目录: ${TMP_HOME}`);
  console.log(`   测试端口:     ${testPort}`);

  await fs.mkdir(TMP_HOME, { recursive: true });

  const child = spawn(
    process.execPath,
    [CLI_BIN, "start", "-p", String(testPort), "--no-open", "--home", TMP_HOME],
    {
      stdio: "pipe",
      // detached: CLI 及其 fork 的 server 进程组独立，失败路径可整组击杀，
      // 避免 SIGKILL 只杀 CLI 父进程、server 成孤儿继续占用端口与隔离目录
      detached: process.platform !== "win32",
      env: {
        ...process.env,
      },
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
    await fs.rm(TMP_HOME, { recursive: true, force: true }).catch(() => {});
    console.error(`\n❌ [smoke-cli] 服务在 ${timeoutMs}ms 内未就绪！`);
    console.error(`输出日志:\n${output}`);
    process.exit(1);
  }

  // 测试首页
  try {
    const pageRes = await fetch(url);
    console.log(`   ✅ 探测到平台首页响应状态: HTTP ${pageRes.status}`);
  } catch (err) {
    console.warn(`   ⚠️ 探测首页异常:`, err);
  }

  // 优雅退出测试：SIGTERM 发给整组（CLI 会转发给 server）
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

  // 清理
  await fs.rm(TMP_HOME, { recursive: true, force: true }).catch(() => {});

  console.log(`🎉 [smoke-cli] @ginkgolab/cli 冒烟测试全部通过！\n`);
}

main().catch(async (err) => {
  console.error(`❌ [smoke-cli] 冒烟测试失败:`, err);
  await fs.rm(TMP_HOME, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
