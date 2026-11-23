/**
 * MCP (Model Context Protocol) 核心类型契约
 */

export type MCPTransportType = "stdio" | "sse" | "streamable_http";

export interface MCPServerConfig {
  /** 唯一标识符，建议短字母数字 */
  id: string;
  /** 显示名称 */
  name?: string;
  /** 传输协议 */
  transport: MCPTransportType;
  /** 是否启用，缺省 true */
  enabled?: boolean;

  // Stdio 传输配置
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  // HTTP / SSE 传输配置
  url?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;

  // 治理与安全沙箱
  /** 工具调用超时时间（毫秒），默认 30_000 */
  timeoutMs?: number;
  /** 允许暴露的工具白名单（空或未定义表示全部暴露） */
  allowedTools?: string[];
  /** 是否在工具名前添加 `${id}_` 前缀以防止全局工具名冲突，默认 true */
  prefixToolName?: boolean;
}

export interface MCPToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    data?: unknown;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPClientStatus {
  serverId: string;
  connected: boolean;
  transport: MCPTransportType;
  toolCount: number;
  lastConnectedAt?: number;
  lastError?: string;
}
