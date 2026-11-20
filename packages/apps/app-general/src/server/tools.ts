import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import type { AppServerContext } from "@openui-analytics/app-sdk";

const execAsync = promisify(exec);

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+(\/|~|\$HOME|\.\.)(\s|$)/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // fork bomb
];

const DEFAULT_IGNORE_PATTERNS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".cache",
  ".DS_Store",
]);

/**
 * 校验并解析目标路径，必须严格在 workspaceDir 范围内
 */
export function assertSafePath(workspaceDir: string, relativePath: string): string {
  const root = path.resolve(workspaceDir);
  const clean = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
  const resolved = path.resolve(root, clean);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`越权访问被拒绝：路径 "${relativePath}" 超出了工作区范围`);
  }
  return resolved;
}

/**
 * 为通用智能助手装配工作区 Tools 集合
 */
export function getGeneralTools(ctx: AppServerContext) {
  // 若未指定 sandboxDir，默认降级为进程下的临时沙箱，确保始终有安全受控的运行目录
  const workspaceDir =
    ctx.workspace?.sandboxDir ||
    path.join(process.cwd(), "data", "workspaces", "general", ctx.sessionId || "default");

  return {
    read_file: tool({
      description:
        "读取工作区内文件的文本内容。支持通过 startLine 和 endLine 参数进行分页/行切片读取，防止大文件超出 Token 限制。",
      parameters: z.object({
        path: z.string().describe("相对于工作区根目录的文件相对路径"),
        startLine: z.number().int().positive().optional().describe("起始行号（从 1 开始，包含）"),
        endLine: z.number().int().positive().optional().describe("结束行号（包含）"),
      }),
      execute: async ({ path: targetPath, startLine, endLine }) => {
        try {
          const safePath = assertSafePath(workspaceDir, targetPath);
          const raw = await fs.readFile(safePath, "utf-8");
          const lines = raw.split("\n");
          const totalLines = lines.length;

          const start = Math.max(1, startLine ?? 1);
          const end = Math.min(totalLines, endLine ?? totalLines);

          if (start > totalLines) {
            return {
              path: targetPath,
              totalLines,
              content: "",
              message: `起始行 ${start} 超出了文件总行数 ${totalLines}`,
            };
          }

          const sliced = lines.slice(start - 1, end).join("\n");
          return {
            path: targetPath,
            totalLines,
            startLine: start,
            endLine: end,
            content: sliced,
          };
        } catch (err) {
          return {
            error: `读取文件失败: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),

    write_file: tool({
      description: "在工作区内创建或全量覆写文件。父级目录不存在时会自动递归创建。",
      parameters: z.object({
        path: z.string().describe("相对于工作区根目录的文件相对路径"),
        content: z.string().describe("要写入的文件完整文本内容"),
      }),
      execute: async ({ path: targetPath, content }) => {
        try {
          const safePath = assertSafePath(workspaceDir, targetPath);
          await fs.mkdir(path.dirname(safePath), { recursive: true });
          await fs.writeFile(safePath, content, "utf-8");
          return {
            success: true,
            path: targetPath,
            bytesWritten: Buffer.byteLength(content, "utf-8"),
          };
        } catch (err) {
          return {
            error: `写入文件失败: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),

    edit_file: tool({
      description:
        "在工作区内的现有文件中查找特定文本块并做精准替换（比全量覆写更节省 Token 且更安全）。",
      parameters: z.object({
        path: z.string().describe("相对于工作区根目录的文件相对路径"),
        target: z.string().describe("需要被替换的目标文本片段（需严格与原文件匹配）"),
        replacement: z.string().describe("替换后的新文本内容"),
      }),
      execute: async ({ path: targetPath, target, replacement }) => {
        try {
          const safePath = assertSafePath(workspaceDir, targetPath);
          const original = await fs.readFile(safePath, "utf-8");

          if (!original.includes(target)) {
            return {
              error: `替换失败：在文件 "${targetPath}" 中未找到与 target 完全匹配的文本块`,
            };
          }

          const updated = original.replace(target, replacement);
          await fs.writeFile(safePath, updated, "utf-8");
          return {
            success: true,
            path: targetPath,
            message: "文件文本块替换成功",
          };
        } catch (err) {
          return {
            error: `编辑文件失败: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),

    run_command: tool({
      description:
        "在当前工作区目录下执行终端 Shell 命令（如构建、安装、代码检查、运行脚本等）。具有命令安全拦截与 30s 超时防护。",
      parameters: z.object({
        command: z.string().describe("要执行的 Shell 命令行"),
        timeoutMs: z.number().int().positive().optional().describe("超时毫秒数，默认 30,000ms"),
      }),
      execute: async ({ command, timeoutMs = 30000 }) => {
        // 安全拦截高危破坏指令
        for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            return {
              error: `安全策略拦截：命令包含潜在的高危破坏性指令 (${command})`,
            };
          }
        }

        try {
          await fs.mkdir(workspaceDir, { recursive: true });
          const { stdout, stderr } = await execAsync(command, {
            cwd: workspaceDir,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024, // 1MB 输出上限
            env: { ...process.env, CI: "true" },
          });

          return {
            success: true,
            command,
            exitCode: 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          };
        } catch (err: unknown) {
          const execError = err as {
            code?: number;
            killed?: boolean;
            signal?: string;
            stdout?: string;
            stderr?: string;
            message?: string;
          };
          return {
            success: false,
            command,
            exitCode: execError.code ?? 1,
            timedOut: execError.killed ?? false,
            stdout: execError.stdout?.trim() ?? "",
            stderr: execError.stderr?.trim() ?? execError.message ?? String(err),
          };
        }
      },
    }),

    list_dir: tool({
      description: "列出工作区内指定目录的文件和子目录树结构，自动过滤 node_modules、.git 等无关目录。",
      parameters: z.object({
        path: z.string().optional().describe("相对工作区的目录路径，缺省为根目录"),
        depth: z.number().int().positive().optional().describe("最大遍历深度，缺省为 2"),
      }),
      execute: async ({ path: dirPath = "", depth = 2 }) => {
        try {
          const safeRoot = assertSafePath(workspaceDir, dirPath);
          await fs.mkdir(safeRoot, { recursive: true });

          interface FileEntry {
            name: string;
            path: string;
            type: "file" | "directory";
            size?: number;
          }

          async function scan(currentDir: string, currentDepth: number): Promise<FileEntry[]> {
            if (currentDepth > depth) return [];
            const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
            const list: FileEntry[] = [];

            for (const entry of dirEntries) {
              if (DEFAULT_IGNORE_PATTERNS.has(entry.name)) continue;
              const full = path.join(currentDir, entry.name);
              const rel = path.relative(workspaceDir, full);

              if (entry.isDirectory()) {
                list.push({ name: entry.name, path: rel, type: "directory" });
                const sub = await scan(full, currentDepth + 1);
                list.push(...sub);
              } else if (entry.isFile()) {
                const stat = await fs.stat(full).catch(() => null);
                list.push({
                  name: entry.name,
                  path: rel,
                  type: "file",
                  size: stat?.size,
                });
              }
            }
            return list;
          }

          const entries = await scan(safeRoot, 1);
          return {
            basePath: dirPath || "/",
            count: entries.length,
            entries,
          };
        } catch (err) {
          return {
            error: `读取目录列表失败: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),
  };
}
