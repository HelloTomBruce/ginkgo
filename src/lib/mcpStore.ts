import fs from "node:fs/promises";
import fsSync from "node:fs";
import {
  MCPClientManager,
  type MCPServerConfig,
} from "@ginkgolab/harness-core/mcp";
import { getMcpServersFile, writeJsonAtomic } from "@/lib/storagePaths";

export interface StoredMcpServer extends MCPServerConfig {
  enabled?: boolean;
}

/**
 * 配置路径惰性解析：存储根可能来自显式配置或宿主引导，
 * 不能在模块加载期固化（否则会先于引导算出 cwd 而分裂存储）。
 */
function configFile(): string {
  return getMcpServersFile();
}

let globalManager: MCPClientManager | null = null;

export function getMcpManager(): MCPClientManager {
  if (!globalManager) {
    globalManager = new MCPClientManager();
    // 启动时载入已配置并启用的 servers
    const servers = loadMcpServersSync();
    const enabledServers = servers.filter((s) => s.enabled !== false);
    if (enabledServers.length > 0) {
      globalManager.registerServers(enabledServers);
    }
  }
  return globalManager;
}

export function loadMcpServersSync(): StoredMcpServer[] {
  try {
    if (!fsSync.existsSync(configFile())) {
      return [];
    }
    const content = fsSync.readFileSync(configFile(), "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[mcpStore] 读取 config/mcp-servers.json 失败:", err);
    return [];
  }
}

export async function loadMcpServers(): Promise<StoredMcpServer[]> {
  try {
    const exists = await fs
      .access(configFile())
      .then(() => true)
      .catch(() => false);
    if (!exists) return [];
    const content = await fs.readFile(configFile(), "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[mcpStore] 异步读取 config/mcp-servers.json 失败:", err);
    return [];
  }
}

export async function saveMcpServers(servers: StoredMcpServer[]): Promise<void> {
  await writeJsonAtomic(configFile(), servers);

  // 同步刷新运行中的 manager
  const mgr = getMcpManager();
  const enabledServers = servers.filter((s) => s.enabled !== false);
  mgr.registerServers(enabledServers);
}

export async function probeMcpServer(config: MCPServerConfig): Promise<{
  ok: boolean;
  latencyMs: number;
  actualTransport?: "stdio" | "sse" | "streamable_http";
  tools: Array<{ name: string; description?: string }>;
  error?: string;
}> {
  const start = Date.now();
  const tempManager = new MCPClientManager();
  tempManager.registerServer({
    ...config,
    timeoutMs: Math.min(config.timeoutMs || 15000, 15000), // 探活上限 15s
  });

  try {
    const tools = await tempManager.listTools(config.id);
    const latencyMs = Date.now() - start;
    const status = tempManager.getStatus(config.id);
    return {
      ok: true,
      latencyMs,
      actualTransport: status?.transport || config.transport,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      tools: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await tempManager.disconnectAll().catch(() => {});
  }
}
