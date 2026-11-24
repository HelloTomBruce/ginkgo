import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

function getEnhancedEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || "";
  const npmGlobalBin = path.join(home, ".npm-global", "bin");
  const currentPath = process.env.PATH || "";
  return {
    ...process.env,
    PATH: `${npmGlobalBin}:/usr/local/bin:/opt/homebrew/bin:${currentPath}`,
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

export class CliBridge {
  static async runCommand(binName: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const env = getEnhancedEnv();
    try {
      const { stdout, stderr } = await execFileAsync(binName, args, {
        cwd,
        env,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, code: 0 };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
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
   * 启动画板本地实时预览服务 (claude-design open <root> --port 0)
   */
  static async serveCanvas(workspaceDir: string): Promise<ServeResult> {
    const res = await this.runCommand("claude-design", ["open", workspaceDir, "--port", "0"], workspaceDir);
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
   * 启动设计系统编辑器本地服务 (claude-design-system open <root> --port 0)
   */
  static async serveDesignSystem(workspaceDir: string): Promise<ServeResult> {
    const res = await this.runCommand("claude-design-system", ["open", workspaceDir, "--port", "0"], workspaceDir);
    try {
      const json = JSON.parse(res.stdout);
      return {
        url: json.url,
        root: json.root,
        pid: json.pid,
      };
    } catch {
      return { error: res.stderr || res.stdout };
    }
  }

  /**
   * 检查工作区是否存在画板配置
   */
  static async getWorkspaceDesignMeta(workspaceDir: string): Promise<{
    hasCanvas: boolean;
    canvasJson?: Record<string, unknown>;
    boards: string[];
    hasDesignSystem: boolean;
    designSystemJson?: Record<string, unknown>;
  }> {
    let hasCanvas = false;
    let canvasJson: Record<string, unknown> | undefined;
    const boards: string[] = [];
    let hasDesignSystem = false;
    let designSystemJson: Record<string, unknown> | undefined;

    try {
      const canvasPath = path.join(workspaceDir, "project", "canvas.json");
      const content = await fs.readFile(canvasPath, "utf-8");
      canvasJson = JSON.parse(content);
      hasCanvas = true;
      if (canvasJson && typeof canvasJson.boards === "object" && canvasJson.boards !== null) {
        boards.push(...Object.keys(canvasJson.boards));
      }
    } catch {
      // not found
    }

    try {
      const dsPath = path.join(workspaceDir, "project", "design-system.json");
      const dsContent = await fs.readFile(dsPath, "utf-8");
      designSystemJson = JSON.parse(dsContent);
      hasDesignSystem = true;
    } catch {
      // not found
    }

    return {
      hasCanvas,
      canvasJson,
      boards,
      hasDesignSystem,
      designSystemJson,
    };
  }
}
