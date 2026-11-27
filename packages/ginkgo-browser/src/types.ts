/**
 * @ginkgolab/browser - 核心类型定义与配置契约
 */

import type { Tool } from "ai";

/**
 * 浏览器权限级别：
 * - "readonly": 仅允许页面打开、快照、查找、截图等无副作用探查（Plan 规划期默认）
 * - "full": 允许点击、输入、表单填充、脚本执行等完整交互（Build 构建期）
 */
export type BrowserPermissionLevel = "readonly" | "full";

/**
 * 工具集规模：
 * - "core": 25 个高频核心自动化工具（推荐，大幅节省 system prompt 常驻 token）
 * - "all": 39 个全量工具（含录制、回放、表单模板、高级抓取等）
 */
export type BrowserToolset = "core" | "all";

export interface CreateBrowserToolsOptions {
  /** 当前会话 ID（用于多会话命名空间隔离，映射至 dsh-browser session scope） */
  sessionId: string;
  /** 会话工作区物理绝对路径（截图、下载文件、代码产物落盘目录） */
  workspaceDir: string;
  /** 权限档级别（缺省 "full"） */
  permissionLevel?: BrowserPermissionLevel;
  /** 工具集裁剪规模（缺省 "core"） */
  toolset?: BrowserToolset;
  /** 是否无头运行（缺省 true，本机调试可显式设为 false） */
  headless?: boolean;
  /** 敏感操作确认审批模式（off | manual | auto，缺省 "off"） */
  confirmMode?: "off" | "manual" | "auto";
  /** 操作默认超时（毫秒，缺省 30000） */
  timeoutMs?: number;
}

export interface BrowserToolsPackage {
  /** 符合 Vercel AI SDK 规范的标准工具集合，可直接展开注入 streamText */
  tools: Record<string, Tool>;
  /** 当前导出的工具名称列表 */
  toolNames: string[];
  /** 浏览器能力系统提示词说明片段 */
  promptSection: string;
  /** 释放/清理当前会话关联的浏览器资源 */
  dispose: () => Promise<void>;
}
