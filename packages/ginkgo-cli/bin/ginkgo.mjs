#!/usr/bin/env node
import { fork, spawn } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(PKG_ROOT, "runtime");
const SERVER_ENTRY = path.join(RUNTIME_DIR, "server.js");
const SEEDS_DIR = path.join(PKG_ROOT, "seeds");

// 读取 package.json 获取版本（读取失败时诚实显示 unknown，避免硬编码版本号随发版漂移）
let pkgVersion = "unknown";
try {
  const pkgContent = JSON.parse(
    await fs.readFile(path.join(PKG_ROOT, "package.json"), "utf-8")
  );
  pkgVersion = pkgContent.version || pkgVersion;
} catch {
  // 保持默认
}

function printHelp() {
  console.log(`
🌱 Ginkgo 智能体应用平台 CLI (v${pkgVersion})

用法:
  ginkgo [命令] [选项]

默认命令:
  start                  启动平台服务并自动打开浏览器

命令列表:
  start                  启动 Ginkgo 服务
  config                 查看当前存储目录与配置信息
  version, -v, --version 打印版本号
  help, -h, --help       显示帮助信息

选项 (用于 start 命令):
  -p, --port <number>    服务监听端口 (默认: 3006, 环境变量: PORT)
  -H, --host <string>    服务监听地址 (默认: localhost, 环境变量: GINKGO_HOST; 局域网访问用 0.0.0.0)
      --home <path>      指定数据与配置存储根目录 (默认: ~/.ginkgo, 环境变量: GINKGO_HOME)
      --no-open          启动完成后不自动打开浏览器
`);
}

/** 跨平台在默认浏览器中打开指定 URL（spawn 数组参数，避免 URL 拼进 shell 字符串） */
function openBrowser(url) {
  try {
    let child;
    if (process.platform === "darwin") {
      child = spawn("open", [url], { detached: true, stdio: "ignore" });
    } else if (process.platform === "win32") {
      // start 是 cmd 内建命令，必须经 cmd /c；"" 是 start 要求的窗口标题占位
      child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    }
    child.unref();
  } catch {
    // 打不开浏览器不阻断服务启动
  }
}

/** 检测端口在 IPv4 和 IPv6 上是否可用 */
async function isPortAvailable(port, host) {
  const check = (h) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, h);
    });

  if (host === "localhost") {
    const v4 = await check("127.0.0.1");
    let v6 = true;
    try {
      v6 = await check("::1");
    } catch {
      // 某些环境不支持 IPv6
    }
    return v4 && v6;
  }
  return check(host);
}

/** 轮询等待服务 HTTP 200 就绪 */
async function waitForHttpReady(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status === 200 || res.status === 404) {
        return true;
      }
    } catch {
      // 尚未连接上，继续重试
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** 初始化 ~/.ginkgo 存储根与种子文件 */
async function ensureGinkgoHome(homeDir) {
  const configDir = path.join(homeDir, "config");
  const dataDir = path.join(homeDir, "data");
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });

  if (fssync.existsSync(SEEDS_DIR)) {
    try {
      const seedFiles = await fs.readdir(SEEDS_DIR);
      for (const file of seedFiles) {
        const dest = path.join(configDir, file);
        if (!fssync.existsSync(dest)) {
          await fs.copyFile(path.join(SEEDS_DIR, file), dest);
        }
      }
    } catch {
      // 容错：种子目录若为空不阻断
    }
  }
}

async function handleStart(args) {
  if (!fssync.existsSync(SERVER_ENTRY)) {
    console.error(`\x1b[31m[错误] 未找到 Ginkgo 独立运行时 (${SERVER_ENTRY})\x1b[0m`);
    console.error(`请确认 @ginkgolab/cli 安装完整，或在仓库内先执行 pnpm build && node scripts/assemble-cli.mjs`);
    process.exit(1);
  }

  // 解析参数。
  // 注意：host 不继承 process.env.HOSTNAME——Docker/部分 CI 会把它设成容器 id 等
  // 非 localhost 值，一旦该名字无法解析为本机地址，端口探测会全部误判为"被占用"。
  // 绑定地址只走显式来源：--host 参数 > GINKGO_HOST 环境变量 > localhost。
  let port = Number(process.env.PORT) || 3006;
  let host = process.env.GINKGO_HOST || "localhost";
  let homeDir =
    process.env.GINKGO_HOME ||
    process.env.GINKGO_DATA_DIR ||
    path.join(os.homedir(), ".ginkgo");
  let autoOpen = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--port") {
      port = Number(args[++i]);
    } else if (arg === "-H" || arg === "--host") {
      host = args[++i];
    } else if (arg === "--home") {
      homeDir = path.resolve(process.cwd(), args[++i]);
    } else if (arg === "--no-open") {
      autoOpen = false;
    }
  }

  // 检测端口（自动递增尝试）
  let portTryCount = 0;
  while (!(await isPortAvailable(port, host)) && portTryCount < 10) {
    console.warn(`\x1b[33m[提示] 端口 ${port} 已被占用，正在尝试端口 ${port + 1}...\x1b[0m`);
    port = port + 1;
    portTryCount++;
  }

  // 递增耗尽后仍不可用：明确报错退出，而不是带着占用的端口去 fork 一个必然
  // EADDRINUSE 崩溃的 server（原始报错对用户没有指向性）。
  if (!(await isPortAvailable(port, host))) {
    console.error(`\x1b[31m[错误] 无法在 ${host}:${port} 启动服务\x1b[0m`);
    console.error(`可能原因:`);
    console.error(`  1. 连续 11 个端口（${port - portTryCount}~${port}）均被占用 —— 用 -p 指定其他端口;`);
    console.error(`  2. 主机名 ${host} 无法解析为本机地址 —— 用 -H 指定，如 -H localhost 或 -H 0.0.0.0;`);
    process.exit(1);
  }

  await ensureGinkgoHome(homeDir);

  console.log(`\x1b[32m🌱 正在启动 Ginkgo 智能体平台...\x1b[0m`);
  console.log(`\x1b[90m   存储主目录: ${homeDir}\x1b[0m`);
  console.log(`\x1b[90m   监听地址:   http://${host}:${port}\x1b[0m`);

  const child = fork(SERVER_ENTRY, [], {
    cwd: RUNTIME_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: host,
      GINKGO_HOME: homeDir,
      GINKGO_RESOLVED_HOME: homeDir,
    },
    stdio: "inherit",
  });

  const forwardSignal = (sig) => {
    try {
      child.kill(sig);
    } catch {
      // 忽略
    }
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // 轮询服务就绪
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const accessUrl = `http://${displayHost}:${port}`;

  const ready = await waitForHttpReady(accessUrl, 25000);
  if (ready) {
    console.log(`\n\x1b[1m\x1b[36m✨ Ginkgo 平台服务已就绪！\x1b[0m`);
    console.log(`\x1b[1m👉 访问地址: \x1b[4m\x1b[34m${accessUrl}\x1b[0m\n`);
    if (autoOpen) {
      openBrowser(accessUrl);
    }
  }
}

async function handleConfig() {
  const homeDir =
    process.env.GINKGO_HOME ||
    process.env.GINKGO_DATA_DIR ||
    path.join(os.homedir(), ".ginkgo");

  console.log(`
🌱 Ginkgo 配置与存储状态:
  - CLI 版本:       v${pkgVersion}
  - 存储根路径:     ${homeDir}
  - 配置文件目录:   ${path.join(homeDir, "config")}
  - 会话数据目录:   ${path.join(homeDir, "data", "sessions")}
  - 插件扩展目录:   ${path.join(homeDir, "plugins")}
`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const first = rawArgs[0];

  if (!first || first === "start") {
    await handleStart(first === "start" ? rawArgs.slice(1) : rawArgs);
  } else if (first === "-v" || first === "--version" || first === "version") {
    console.log(`v${pkgVersion}`);
  } else if (first === "-h" || first === "--help" || first === "help") {
    printHelp();
  } else if (first === "config") {
    await handleConfig();
  } else {
    // 默认当作启动选项处理（例如用户执行 `ginkgo -p 8080`）
    await handleStart(rawArgs);
  }
}

main().catch((err) => {
  console.error(`\x1b[31m[CLI 运行异常]:\x1b[0m`, err);
  process.exit(1);
});
