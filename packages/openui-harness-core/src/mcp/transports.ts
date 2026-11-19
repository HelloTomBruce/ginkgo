import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPServerConfig } from "./types";

/**
 * 根据服务端配置创建对应的底层 MCP Client Transport
 */
export async function createClientTransport(
  config: MCPServerConfig
): Promise<Transport> {
  if (config.transport === "stdio") {
    if (!config.command) {
      throw new Error(`[MCP] stdio 传输必须指定 command，配置 ID: ${config.id}`);
    }
    const mergedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") mergedEnv[k] = v;
    }
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        if (typeof v === "string") mergedEnv[k] = v;
      }
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: mergedEnv,
      cwd: config.cwd,
    });
  }

  if (!config.url) {
    throw new Error(`[MCP] ${config.transport} 传输必须指定 url，配置 ID: ${config.id}`);
  }

  const targetUrl = new URL(config.url);
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      targetUrl.searchParams.set(key, value);
    }
  }

  const headers = config.headers ?? {};

  if (config.transport === "streamable_http") {
    try {
      return new StreamableHTTPClientTransport(targetUrl, {
        requestInit: { headers },
      });
    } catch {
      // 若 Streamable HTTP 不可用，优雅回退至 SSE
      return new SSEClientTransport(targetUrl, {
        requestInit: { headers },
      });
    }
  }

  // transport === "sse"
  return new SSEClientTransport(targetUrl, {
    requestInit: { headers },
  });
}
