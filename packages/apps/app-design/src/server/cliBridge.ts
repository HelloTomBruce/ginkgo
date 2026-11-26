import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * 候选可执行文件名：Windows 下 npm 生成的是 `foo.cmd`（部分工具是 `.exe`），
 * 直接找无后缀的 `foo` 会 miss。
 */
function binFileNames(binName: string): string[] {
  if (process.platform !== "win32") return [binName];
  return [`${binName}.cmd`, `${binName}.exe`, binName];
}

/** 在目录下按平台约定查找可执行文件，命中返回绝对路径 */
function findInBinDir(binDir: string, binName: string): string | null {
  for (const fileName of binFileNames(binName)) {
    const candidate = path.join(binDir, fileName);
    try {
      if (fsSync.existsSync(candidate)) return candidate;
    } catch {
      // 权限问题等按未命中处理
    }
  }
  return null;
}

/**
 * 本地 node_modules/.bin 与插件隔离区自适应寻址（跨平台）。
 */
export function resolveBinExecutable(binName: string, cwd?: string): string {
  // 1. 优先检查指定工作区目录下的 node_modules/.bin
  if (cwd) {
    const hit = findInBinDir(path.join(cwd, "node_modules", ".bin"), binName);
    if (hit) return hit;
  }
  // 2. 检查应用进程根目录下的 node_modules/.bin
  const projectHit = findInBinDir(
    path.join(process.cwd(), "node_modules", ".bin"),
    binName
  );
  if (projectHit) return projectHit;

  // 3. 检查 GINKGO_HOME/plugins/node_modules/.bin
  const home =
    process.env.GINKGO_RESOLVED_HOME ||
    process.env.GINKGO_HOME ||
    (process.env.HOME || process.env.USERPROFILE
      ? path.join(process.env.HOME || process.env.USERPROFILE || "", ".ginkgo")
      : "");
  if (home) {
    const pluginHit = findInBinDir(
      path.join(home, "plugins", "node_modules", ".bin"),
      binName
    );
    if (pluginHit) return pluginHit;
  }

  // 4. 回退为直接使用 binName，由 PATH 寻址
  return binName;
}

/**
 * 探测外部 CLI 是否可用（跨平台）。
 *
 * 判定语义：ENOENT = 没装（false）；其它错误 = 命令存在但 `--version` 执行失败
 * （仍算已安装，交由调用方决定是否降级），避免把"能执行但返回非 0"误判为缺失。
 */
export async function probeCliAvailable(binName: string): Promise<boolean> {
  const resolved = resolveBinExecutable(binName);
  try {
    await execFileAsync(resolved, ["--version"], {
      env: getEnhancedEnv(),
      timeout: 8_000,
      windowsHide: true,
    });
    return true;
  } catch (err: unknown) {
    return (err as { code?: string }).code !== "ENOENT";
  }
}

function getEnhancedEnv(cwd?: string): NodeJS.ProcessEnv {
  const home = process.env.HOME || "";
  const npmGlobalBin = path.join(home, ".npm-global", "bin");
  const currentPath = process.env.PATH || "";
  const cwdBin = cwd ? path.join(cwd, "node_modules", ".bin") : "";
  const projectBin = path.join(process.cwd(), "node_modules", ".bin");

  const pathSegments = [
    cwdBin,
    projectBin,
    npmGlobalBin,
    "/usr/local/bin",
    "/opt/homebrew/bin",
    currentPath,
  ].filter(Boolean);

  return {
    ...process.env,
    // Windows 的 PATH 分隔符是 ";"，不能用 ":"
    PATH: pathSegments.join(path.delimiter),
  };
}

export interface CanvasCheckResult {
  root?: string;
  title?: string;
  boardCount?: number;
  problems: number;
  issues?: Array<{ file: string; message: string }>;
  rawOutput?: string;
}

export interface ServeResult {
  url?: string;
  root?: string;
  pid?: number;
  log?: string;
  stopped?: boolean;
  error?: string;
}

export interface BoardDetail {
  key: string;
  title: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface DashboardArtifact {
  id: string;
  title: string;
  path: string;
  relativePath: string;
  sizeBytes?: number;
  updatedAt?: number;
}

export interface WorkspaceDesignMeta {
  hasCanvas: boolean;
  canvasJson?: Record<string, unknown>;
  boards: string[];
  boardsDetail: BoardDetail[];
  dashboards: DashboardArtifact[];
  hasDesignSystem: boolean;
  designSystemJson?: Record<string, unknown>;
}

export class CliBridge {
  static async runCommand(
    binName: string,
    args: string[],
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const resolvedBin = resolveBinExecutable(binName, cwd);
    const env = getEnhancedEnv(cwd);
    try {
      const { stdout, stderr } = await execFileAsync(resolvedBin, args, {
        cwd,
        env,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, code: 0 };
    } catch (err: unknown) {
      const execErr = err as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        message?: string;
      };
      // 拦截未找到命令 (ENOENT) 并返回友好指引与状态码 127
      if (
        execErr.code === "ENOENT" ||
        (typeof execErr.message === "string" && execErr.message.includes("ENOENT"))
      ) {
        return {
          stdout: "",
          stderr: `[依赖缺失] 未在系统环境或本地 node_modules 中检测到 CLI 工具 "${binName}"。在独立/npm分发运行模式下，请先执行 "npm install -g ${binName}" 进行补齐。`,
          code: 127,
        };
      }
      return {
        stdout: execErr.stdout || "",
        stderr: execErr.stderr || execErr.message || String(err),
        code: typeof execErr.code === "number" ? execErr.code : 1,
      };
    }
  }

  /**
   * 检查画板项目的合法性与规范 (claude-design check <root>)
   */
  static async checkCanvas(workspaceDir: string): Promise<CanvasCheckResult> {
    const res = await this.runCommand("claude-design", ["check", workspaceDir], workspaceDir);
    try {
      const json = JSON.parse(res.stdout);
      return {
        root: json.root,
        title: json.title,
        boardCount: json.boardCount,
        problems: typeof json.problems === "number" ? json.problems : 0,
        issues: json.issues,
      };
    } catch {
      return {
        problems: res.code === 0 ? 0 : 1,
        rawOutput: res.stdout || res.stderr,
      };
    }
  }

  /**
   * 启动画板本地实时预览服务 (claude-design open <root> [--port <port>])
   * 严禁传入 --port 0（会强制内核分配 50000+ 随机高位端口导致预览地址飘逸），
   * 默认使用官方受控标准端口（4720 左右，可由 CLAUDE_DESIGN_PORT 指定）。
   */
  static async serveCanvas(workspaceDir: string, port?: number): Promise<ServeResult> {
    const targetPort = port || (process.env.CLAUDE_DESIGN_PORT ? Number(process.env.CLAUDE_DESIGN_PORT) : undefined);
    const args = ["open", workspaceDir];
    if (targetPort && Number.isFinite(targetPort) && targetPort > 0) {
      args.push("--port", String(targetPort));
    }
    const res = await this.runCommand("claude-design", args, workspaceDir);
    try {
      const json = JSON.parse(res.stdout);
      return {
        url: json.url,
        root: json.root,
        pid: json.pid,
        log: json.log,
      };
    } catch {
      if (res.code === 0 && res.stdout.includes("http://")) {
        const match = res.stdout.match(/https?:\/\/[^\s]+/);
        return { url: match ? match[0] : undefined };
      }
      return {
        error: res.stderr || res.stdout || "启动画板服务失败",
      };
    }
  }

  /**
   * 停止画板本地服务 (claude-design stop <root>)
   */
  static async stopCanvas(workspaceDir: string): Promise<{ stopped: boolean }> {
    const res = await this.runCommand("claude-design", ["stop", workspaceDir], workspaceDir);
    try {
      const json = JSON.parse(res.stdout);
      return { stopped: Boolean(json.stopped) };
    } catch {
      return { stopped: res.code === 0 };
    }
  }

  /**
   * 扫描并审查前端代码中的 Design Token 规范 (claude-design-system audit <dir>)
   */
  static async auditDesignSystem(targetDir: string): Promise<{ report: string; passed: boolean }> {
    const res = await this.runCommand("claude-design-system", ["audit", targetDir], targetDir);
    const output = res.stdout + (res.stderr ? `\n${res.stderr}` : "");
    const passed = res.code === 0 || output.includes("审查通过");
    return {
      report: output.trim(),
      passed,
    };
  }

  /**
   * 启动设计系统编辑器本地服务 (claude-design-system open <root> [--port <port>])
   */
  static async serveDesignSystem(workspaceDir: string, port?: number): Promise<ServeResult> {
    const targetPort = port || (process.env.CLAUDE_DS_PORT ? Number(process.env.CLAUDE_DS_PORT) : undefined);
    const args = ["open", workspaceDir];
    if (targetPort && Number.isFinite(targetPort) && targetPort > 0) {
      args.push("--port", String(targetPort));
    }
    const res = await this.runCommand("claude-design-system", args, workspaceDir);
    try {
      const json = JSON.parse(res.stdout);
      return {
        url: json.url,
        root: json.root,
        pid: json.pid,
      };
    } catch {
      if (res.code === 0 && res.stdout.includes("http://")) {
        const match = res.stdout.match(/https?:\/\/[^\s]+/);
        return { url: match ? match[0] : undefined };
      }
      return { error: res.stderr || res.stdout || "启动设计系统服务失败" };
    }
  }

  /**
   * 停止设计系统本地服务 (claude-design-system stop <root>)
   */
  static async stopDesignSystem(workspaceDir: string): Promise<{ stopped: boolean }> {
    const res = await this.runCommand("claude-design-system", ["stop", workspaceDir], workspaceDir);
    try {
      const json = JSON.parse(res.stdout);
      return { stopped: Boolean(json.stopped) };
    } catch {
      return { stopped: res.code === 0 };
    }
  }

  /**
   * 检查工作区资产元数据（画板、数据看板 Claude Data、设计系统 Tokens 等）
   */
  static async getWorkspaceDesignMeta(workspaceDir: string): Promise<WorkspaceDesignMeta> {
    let hasCanvas = false;
    let canvasJson: Record<string, unknown> | undefined;
    const boards: string[] = [];
    const boardsDetail: BoardDetail[] = [];
    const dashboards: DashboardArtifact[] = [];
    let hasDesignSystem = false;
    let designSystemJson: Record<string, unknown> | undefined;

    // 1. 扫描视觉画板（canvas.json）
    try {
      const canvasPath = path.join(workspaceDir, "project", "canvas.json");
      const content = await fs.readFile(canvasPath, "utf-8");
      canvasJson = JSON.parse(content);
      hasCanvas = true;
      if (canvasJson && typeof canvasJson.boards === "object" && canvasJson.boards !== null) {
        for (const [key, rawMeta] of Object.entries(
          canvasJson.boards as Record<string, Record<string, unknown>>
        )) {
          boards.push(key);
          boardsDetail.push({
            key,
            title: typeof rawMeta?.title === "string" ? rawMeta.title : key,
            width: typeof rawMeta?.w === "number" ? rawMeta.w : 880,
            height: typeof rawMeta?.h === "number" ? rawMeta.h : 560,
            x: typeof rawMeta?.x === "number" ? rawMeta.x : undefined,
            y: typeof rawMeta?.y === "number" ? rawMeta.y : undefined,
          });
        }
      }
    } catch {
      // not found
    }

    // 2. 扫描数据看板（强约定：必须存放在 project/ 产物目录下）
    const scanDirs = [
      path.join(workspaceDir, "project"),
      path.join(workspaceDir, "project", "dashboards"),
    ];
    const seenDashboards = new Set<string>();

    for (const dir of scanDirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith(".dashboard.html") || entry.name === "dashboard.html")) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(workspaceDir, fullPath);
            if (!seenDashboards.has(relPath)) {
              seenDashboards.add(relPath);
              let title = entry.name.replace(/\.dashboard\.html$/, "").replace(/\.html$/, "");
              if (title === "dashboard") title = "业务数据看板";
              try {
                const stat = await fs.stat(fullPath);
                dashboards.push({
                  id: `data:${relPath}`,
                  title,
                  path: fullPath,
                  relativePath: relPath,
                  sizeBytes: stat.size,
                  updatedAt: Math.round(stat.mtimeMs),
                });
              } catch {
                dashboards.push({
                  id: `data:${relPath}`,
                  title,
                  path: fullPath,
                  relativePath: relPath,
                });
              }
            }
          }
        }
      } catch {
        // dir does not exist or unreadable, ignore
      }
    }

    // 3. 扫描设计系统（强约定：必须存放在 project/ 产物目录下）
    const candidateDsPaths = [
      path.join(workspaceDir, "project", "design-system.json"),
      path.join(workspaceDir, "project", "tokens.json"),
    ];

    for (const dsPath of candidateDsPaths) {
      try {
        const dsContent = await fs.readFile(dsPath, "utf-8");
        designSystemJson = JSON.parse(dsContent);
        hasDesignSystem = true;
        break;
      } catch {
        // try next
      }
    }

    return {
      hasCanvas,
      canvasJson,
      boards,
      boardsDetail,
      dashboards,
      hasDesignSystem,
      designSystemJson,
    };
  }
}
