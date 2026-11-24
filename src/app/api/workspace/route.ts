import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveWorkspaceContext, resolveSafeWorkspacePath } from "@/lib/workspaceResolver";
import { sessionStore } from "@/lib/sessionStore";
import { workspaceStore } from "@/lib/workspaceStore";

const execAsync = promisify(exec);

export const DEFAULT_WORKSPACE_IGNORE_PATTERNS = new Set([
  // 1. 依赖与包管理 (Node / Python / Go / PHP / iOS)
  "node_modules",
  ".pnpm-store",
  ".yarn",
  "vendor",
  "Pods",
  ".venv",
  "venv",
  "env",
  "virtualenv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",

  // 2. 构建产物与打包输出 (Next.js / Vite / Webpack / Rust / Java / .NET)
  ".next",
  ".nuxt",
  ".output",
  ".astro",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  ".turbo",
  ".parcel-cache",

  // 3. 版本控制与代码仓库元数据
  ".git",
  ".svn",
  ".hg",

  // 4. 测试与代码覆盖率报告
  "coverage",
  ".nyc_output",

  // 5. IDE、系统杂项与本地临时缓存
  ".idea",
  ".cache",
  "temp",
  "tmp",
  ".DS_Store",
  "Thumbs.db",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".mov", ".wasm", ".exe", ".bin",
]);

const MAX_SCAN_ITEMS = 1000;

interface WorkspaceFileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt: number;
}

/**
 * GET /api/workspace
 * 查询工作区文件树或单个文件内容
 * - ?appId=general&sessionId=xxx : 返回文件树列表
 * - ?appId=general&sessionId=xxx&filePath=src/index.ts : 返回文件文本内容
 *
 * 安全线约束：工作区根目录一律由服务端从 sessionStore→workspaceStore
 * 按 sessionId 解析（或回落默认沙箱），不接受客户端透传的文件系统路径。
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appId = searchParams.get("appId") || "general";
    const sessionId = searchParams.get("sessionId") || "default";
    const filePath = searchParams.get("filePath");
    const action = searchParams.get("action");

    let customRootDir: string | undefined;
    if (sessionId && sessionId !== "default") {
      const sessionRecord = await sessionStore.get(sessionId);
      if (sessionRecord?.workspaceId) {
        const wsRecord = await workspaceStore.get(sessionRecord.workspaceId);
        if (wsRecord?.path) {
          customRootDir = wsRecord.path;
        }
      }
    }

    const ws = await resolveWorkspaceContext({ appId, sessionId, customRootDir });

    // 0. Git 状态查询分支
    if (action === "git_status") {
      try {
        await execAsync("git rev-parse --is-inside-work-tree", { cwd: ws.sandboxDir });
      } catch {
        return NextResponse.json({
          isGitRepo: false,
          branch: "",
          changes: [],
        });
      }

      let branch = "main";
      try {
        const { stdout } = await execAsync("git branch --show-current", { cwd: ws.sandboxDir });
        branch = stdout.trim() || "HEAD";
      } catch {
        // 忽略分支获取异常
      }

      const { stdout: statusOut } = await execAsync("git status --porcelain=v1", { cwd: ws.sandboxDir });
      const lines = statusOut.split("\n").filter(Boolean);
      const changes: Array<{
        path: string;
        status: "modified" | "added" | "deleted" | "untracked";
        diff?: string;
      }> = [];

      for (const line of lines) {
        const code = line.slice(0, 2);
        const relPath = line.slice(3).trim();
        let status: "modified" | "added" | "deleted" | "untracked" = "modified";
        if (code.includes("?")) status = "untracked";
        else if (code.includes("A")) status = "added";
        else if (code.includes("D")) status = "deleted";

        let diff: string | undefined;
        try {
          if (status === "untracked") {
            const abs = path.join(ws.sandboxDir, relPath);
            const content = await fs.readFile(abs, "utf-8").catch(() => "");
            diff = content
              .split("\n")
              .map((l) => `+${l}`)
              .join("\n");
          } else {
            const { stdout: diffOut } = await execAsync(`git diff HEAD -- "${relPath}"`, {
              cwd: ws.sandboxDir,
            });
            diff = diffOut || undefined;
          }
        } catch {
          // 忽略单个文件的 diff 获取失败
        }

        changes.push({ path: relPath, status, diff });
      }

      return NextResponse.json({
        isGitRepo: true,
        branch,
        changes,
      });
    }

    // 1. 若指定了 filePath，读取文件内容
    if (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        return NextResponse.json({
          path: filePath,
          size: 0,
          updatedAt: Date.now(),
          content: "[二进制文件，暂不支持纯文本预览]",
          isBinary: true,
        });
      }

      const safeFile = resolveSafeWorkspacePath(ws.sandboxDir, filePath);
      try {
        const stat = await fs.stat(safeFile);
        if (!stat.isFile()) {
          return NextResponse.json({ error: "目标路径不是普通文件" }, { status: 400 });
        }
        // 文件大小超过 2MB 时避免直接加载到内存
        if (stat.size > 2 * 1024 * 1024) {
          return NextResponse.json({
            path: filePath,
            size: stat.size,
            updatedAt: stat.mtimeMs,
            content: `[文件过大 (${Math.round(stat.size / 1024)} KB)，超出工作台在线预览限制 (2MB)]`,
            isBinary: false,
          });
        }
        const content = await fs.readFile(safeFile, "utf-8");
        return NextResponse.json({
          path: filePath,
          size: stat.size,
          updatedAt: stat.mtimeMs,
          content,
        });
      } catch {
        return NextResponse.json({ error: "文件不存在或无法读取" }, { status: 404 });
      }
    }

    // 2. 未指定 filePath，扫描工作区文件树（带条目熔断保护）
    let totalItems = 0;
    async function scan(currentDir: string, depth = 1): Promise<WorkspaceFileItem[]> {
      if (depth > 8 || totalItems >= MAX_SCAN_ITEMS) return [];
      const dirEntries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      const items: WorkspaceFileItem[] = [];

      for (const entry of dirEntries) {
        if (totalItems >= MAX_SCAN_ITEMS) break;
        if (DEFAULT_WORKSPACE_IGNORE_PATTERNS.has(entry.name)) continue;
        const full = path.join(currentDir, entry.name);
        const rel = path.relative(ws.sandboxDir, full);

        if (entry.isDirectory()) {
          totalItems++;
          items.push({
            name: entry.name,
            path: rel,
            type: "directory",
            updatedAt: Date.now(),
          });
          const sub = await scan(full, depth + 1);
          items.push(...sub);
        } else if (entry.isFile()) {
          totalItems++;
          const stat = await fs.stat(full).catch(() => null);
          items.push({
            name: entry.name,
            path: rel,
            type: "file",
            size: stat?.size,
            updatedAt: stat?.mtimeMs ?? Date.now(),
          });
        }
      }
      return items;
    }

    const files = await scan(ws.sandboxDir);
    return NextResponse.json({
      appId,
      sessionId,
      sandboxDir: ws.sandboxDir,
      count: files.length,
      truncated: totalItems >= MAX_SCAN_ITEMS,
      files,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "工作区查询失败" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspace
 * 在工作区沙箱执行轻量终端交互指令（如 git、测试、查看日志）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const appId = body.appId || "general";
    const sessionId = body.sessionId || "default";
    const command = String(body.command || "").trim();

    if (!command) {
      return NextResponse.json({ error: "命令不能为空" }, { status: 400 });
    }

    // 安全检查高危破坏指令
    const DANGEROUS = [
      /\brm\s+-[rf]{1,2}\s+(\/|~|\$HOME|\.\.)(\s|$)/i,
      /\bmkfs\b/i,
      /\bshutdown\b/i,
      /\breboot\b/i,
      /\bdd\s+if=/i,
      /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i,
    ];
    for (const pattern of DANGEROUS) {
      if (pattern.test(command)) {
        return NextResponse.json(
          { error: `安全策略拦截：命令包含潜在的高危破坏性指令 (${command})` },
          { status: 403 }
        );
      }
    }

    let customRootDir: string | undefined;
    if (sessionId && sessionId !== "default") {
      const sessionRecord = await sessionStore.get(sessionId);
      if (sessionRecord?.workspaceId) {
        const wsRecord = await workspaceStore.get(sessionRecord.workspaceId);
        if (wsRecord?.path) {
          customRootDir = wsRecord.path;
        }
      }
    }

    const ws = await resolveWorkspaceContext({ appId, sessionId, customRootDir });
    await fs.mkdir(ws.sandboxDir, { recursive: true });

    const startTime = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ws.sandboxDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return NextResponse.json({
        success: true,
        command,
        stdout,
        stderr,
        exitCode: 0,
        durationMs: Date.now() - startTime,
      });
    } catch (execErr: unknown) {
      const err = execErr as { stdout?: string; stderr?: string; code?: number; message?: string };
      return NextResponse.json({
        success: false,
        command,
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "",
        exitCode: typeof err.code === "number" ? err.code : 1,
        durationMs: Date.now() - startTime,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "命令执行失败" },
      { status: 500 }
    );
  }
}

