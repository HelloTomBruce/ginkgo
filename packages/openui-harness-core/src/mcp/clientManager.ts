import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createClientTransport } from "./transports";
import type {
  MCPClientStatus,
  MCPServerConfig,
  MCPToolCallResult,
} from "./types";

const SESSION_EXPIRED_RE =
  /session not found|session expired|invalid session|session_id invalid/i;

interface ManagedClient {
  config: MCPServerConfig;
  client?: Client;
  connectPromise?: Promise<Client>;
  tools: Tool[];
  status: MCPClientStatus;
}

/**
 * 通用 MCP 客户端连接与生命周期管理中心 (对标 Cursor / Claude Desktop MCP Manager)
 */
export class MCPClientManager {
  private readonly servers = new Map<string, ManagedClient>();

  /**
   * 注册并配置一个 MCP Server（懒连接或即时连接）
   */
  registerServer(config: MCPServerConfig): void {
    if (this.servers.has(config.id)) {
      this.disconnect(config.id).catch(() => {});
    }
    this.servers.set(config.id, {
      config,
      tools: [],
      status: {
        serverId: config.id,
        connected: false,
        transport: config.transport,
        toolCount: 0,
      },
    });
  }

  /**
   * 批量注册 MCP Servers
   */
  registerServers(configs: MCPServerConfig[]): void {
    for (const conf of configs) {
      this.registerServer(conf);
    }
  }

  /**
   * 获取或建立与指定 MCP Server 的连接
   */
  async getClient(serverId: string): Promise<Client> {
    const managed = this.servers.get(serverId);
    if (!managed) {
      throw new Error(`[MCP] 未注册的 MCP Server: ${serverId}`);
    }

    if (managed.client) {
      return managed.client;
    }

    if (managed.connectPromise) {
      return managed.connectPromise;
    }

    managed.connectPromise = (async () => {
      try {
        const transport = await createClientTransport(managed.config);
        const client = new Client(
          {
            name: `harness-mcp-client-${managed.config.id}`,
            version: "1.0.0",
          },
          {
            capabilities: {},
          }
        );

        await client.connect(transport);
        managed.client = client;
        managed.status.connected = true;
        managed.status.lastConnectedAt = Date.now();
        managed.status.lastError = undefined;

        // 自动拉取工具列表
        const { tools } = await client.listTools();
        managed.tools = tools;
        managed.status.toolCount = tools.length;

        return client;
      } catch (err) {
        managed.client = undefined;
        managed.status.connected = false;
        managed.status.lastError =
          err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        managed.connectPromise = undefined;
      }
    })();

    return managed.connectPromise;
  }

  /**
   * 获取指定 Server 暴露的所有 MCP Tool
   */
  async listTools(serverId: string): Promise<Tool[]> {
    const client = await this.getClient(serverId);
    const managed = this.servers.get(serverId)!;

    return this.withSessionRetry(serverId, async () => {
      const { tools } = await client.listTools();
      managed.tools = tools;
      managed.status.toolCount = tools.length;

      if (managed.config.allowedTools && managed.config.allowedTools.length > 0) {
        const allowedSet = new Set(managed.config.allowedTools);
        return tools.filter((t) => allowedSet.has(t.name));
      }
      return tools;
    });
  }

  /**
   * 执行指定的 MCP 工具调用
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const managed = this.servers.get(serverId);
    if (!managed) {
      throw new Error(`[MCP] 未注册的 MCP Server: ${serverId}`);
    }

    return this.withSessionRetry(serverId, async () => {
      const client = await this.getClient(serverId);
      const timeoutMs = managed.config.timeoutMs ?? 30_000;

      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `[MCP] 工具调用超时 (${timeoutMs}ms): ${serverId}.${toolName}`
            )
          );
        }, timeoutMs);
      });

      try {
        const callPromise = client.callTool({
          name: toolName,
          arguments: args,
        });

        const res = await Promise.race([callPromise, timeoutPromise]);
        return res as MCPToolCallResult;
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
  }

  /**
   * 断开指定 Server 连接
   */
  async disconnect(serverId: string): Promise<void> {
    const managed = this.servers.get(serverId);
    if (!managed) return;

    if (managed.client) {
      try {
        await managed.client.close();
      } catch {
        // 忽略关闭异常
      }
      managed.client = undefined;
    }
    managed.connectPromise = undefined;
    managed.status.connected = false;
  }

  /**
   * 断开所有 Server 连接并清空
   */
  async disconnectAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const serverId of this.servers.keys()) {
      tasks.push(this.disconnect(serverId));
    }
    await Promise.allSettled(tasks);
    this.servers.clear();
  }

  /**
   * 获取所有已注册 Server 的状态快照
   */
  getAllStatus(): MCPClientStatus[] {
    return Array.from(this.servers.values()).map((s) => ({ ...s.status }));
  }

  /**
   * 会话失效透明重试包装器（Session not found 自动重连）
   */
  private async withSessionRetry<T>(
    serverId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!SESSION_EXPIRED_RE.test(msg)) {
        throw err;
      }

      // 触发一次断开并重连重试
      await this.disconnect(serverId);
      return await fn();
    }
  }
}
