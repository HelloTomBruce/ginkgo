import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { CoreTool } from "ai";
import { zodTool } from "@ginkgolab/harness-core";

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
 * 工具集预设（原子优先，参照现代编码代理的内核哲学）：
 * - "atomic"：read / edit / write / bash 四把原子工具。文件检索、Git、测试、
 *   日志等一切经 run_command 组合 Unix CLI（ls / find / rg / git …）完成，
 *   模型在后训练阶段已充分掌握这些用法，无需为每类操作造一把专用工具。
 * - "explorer"：atomic + list_dir 只读探索增强（按需启用的可选工具集）。
 */
export type SandboxToolsPreset = "atomic" | "explorer";

/**
 * 权限档位（与 preset 正交）：
 * - "full"：全量工具（缺省）。
 * - "readonly"：只读——仅装配无副作用的工具（read_file，explorer 时含 list_dir），
 *   不装配写文件与 shell 执行。工具集即能力边界（不装配而非装配后拒绝）：
 *   模型幻调未装配工具会收到「工具不存在 + 可用工具列表」反馈（编排层
 *   repairToolCallToFeedback 链路）并自我调整；prompt 侧配套说明解锁路径。
 *   「会话阶段 → 权限档位」的映射属应用策略（如 plan → readonly），
 *   能力包不感知具体语义。
 */
export type SandboxPermission = "full" | "readonly";

/**
 * 校验并解析目标路径，必须严格在 sandboxDir 范围内
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
 * run_command 子进程环境白名单：只透传跨工具链必需的基础键与代理配置。
 * 敏感变量（API Key 等）绝不进入模型可诱导的 shell 环境；需要额外变量的
 * 场景经 createSandboxTools 的 env 注入位显式放行。
 */
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TERM",
  "COLUMNS",
  "LINES",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

function buildChildEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CI = "true";
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      env[key] = value;
    }
  }
  return env;
}

interface SandboxToolDeps {
  workspaceDir: string;
  extraEnv?: Record<string, string>;
}

function buildReadFileTool({ workspaceDir }: SandboxToolDeps) {
  return zodTool({
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
  });
}

function buildWriteFileTool({ workspaceDir }: SandboxToolDeps) {
  return zodTool({
    description: "在工作区内创建或全量覆写文件。父级目录不存在时会自动递归创建。",
    parameters: z.object({
      path: z.string().describe("相对于工作区根目录的文件相对路径"),
      content: z.string().describe("要写入文件的完整文本内容"),
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
  });
}

function buildEditFileTool({ workspaceDir }: SandboxToolDeps) {
  return zodTool({
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
  });
}

function buildRunCommandTool({ workspaceDir, extraEnv }: SandboxToolDeps) {
  return zodTool({
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
          // 白名单 env（不含 NODE_ENV）；宿主 next-env.d.ts 将 NODE_ENV 增强为
          // ProcessEnv 必填，与「最小子进程环境」目标冲突，此处显式断言收窄
          env: buildChildEnv(extraEnv) as NodeJS.ProcessEnv,
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
  });
}

function buildListDirTool({ workspaceDir }: SandboxToolDeps) {
  return zodTool({
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
  });
}

/** 模式提权审批工具（在 Plan 规划只读模式下向用户申请切入 Build 模式） */
export function buildRequestBuildPermissionTool(): CoreTool {
  return zodTool({
    description:
      "当处于 Plan 规划模式（只读）且当前任务需要修改代码、创建文件、安装依赖或执行命令时，" +
      "调用此工具向用户申请切换至 Build 模式的执行权限，并向用户展示拟修改方案清单与风险评估。",
    parameters: z.object({
      summary: z.string().describe("技术方案摘要与本次申请提权的原因"),
      changes: z
        .array(
          z.object({
            type: z
              .enum(["file_create", "file_modify", "dependency_install", "command", "database"])
              .describe("变更类型"),
            target: z.string().describe("变更目标路径或名称，例如 'src/components/Login.tsx'"),
            description: z.string().optional().describe("变更简要说明"),
          })
        )
        .optional()
        .describe("拟变更内容清单"),
      riskLevel: z
        .enum(["low", "medium", "high"])
        .optional()
        .default("medium")
        .describe("变更风险等级：low/medium/high"),
      actionPrompt: z
        .string()
        .optional()
        .describe("用户批准后自动发送给大模型的启动指令（缺省将自动根据方案生成）"),
    }),
    execute: async (args) => {
      return {
        ok: true,
        status: "pending_approval",
        message: "已向用户发起 Build 模式权限申请与变更清单展示，等待用户确认...",
        payload: args,
      };
    },
  });
}

/**
 * 沙箱工作区能力包工厂：为应用提供会话沙箱内的原子文件/shell 工具集。
 * 能力包不感知具体应用——消费方（应用包）在自己的 getTools 接缝内实例化，
 * sandboxDir 由宿主经 AppServerContext.workspace 注入。
 * preset 决定工具丰富度、permission 决定能力边界（readonly 只装配只读工具）。
 */
export function createSandboxTools(opts: {
  sandboxDir: string;
  /** 工具集预设，缺省 "atomic"（read/edit/write/bash 四原子工具） */
  preset?: SandboxToolsPreset;
  /** 权限档位，缺省 "full"；readonly 仅装配只读工具（写/shell 不出现） */
  permission?: SandboxPermission;
  /** run_command 子进程的额外环境变量（白名单之上的显式放行，如 GITHUB_TOKEN） */
  env?: Record<string, string>;
}): Record<string, CoreTool> {
  const deps: SandboxToolDeps = {
    workspaceDir: opts.sandboxDir,
    extraEnv: opts.env,
  };
  const tools: Record<string, CoreTool> = {
    read_file: buildReadFileTool(deps),
  };
  if (opts.permission !== "readonly") {
    tools.write_file = buildWriteFileTool(deps);
    tools.edit_file = buildEditFileTool(deps);
    tools.run_command = buildRunCommandTool(deps);
  } else {
    // 只读规划模式下，装配模式提权审批工具供模型主动申请构建权限
    tools.request_build_permission = buildRequestBuildPermissionTool();
  }
  if (opts.preset === "explorer") {
    tools.list_dir = buildListDirTool(deps);
  }
  return tools;
}
