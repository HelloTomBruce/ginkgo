import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  MCPClientManager,
  type MCPServerConfig,
} from "@openui-analytics/harness-core/mcp";

export interface StoredMcpServer extends MCPServerConfig {
  enabled?: boolean;
}

const CONFIG_FILE = path.join(process.cwd(), "config", "mcp-servers.json");

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
    if (!fsSync.existsSync(CONFIG_FILE)) {
      return [];
    }
    const content = fsSync.readFileSync(CONFIG_FILE, "utf-8");
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
      .access(CONFIG_FILE)
      .then(() => true)
      .catch(() => false);
    if (!exists) return [];
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[mcpStore] 异步读取 config/mcp-servers.json 失败:", err);
    return [];
  }
}

export async function saveMcpServers(servers: StoredMcpServer[]): Promise<void> {
  const dir = path.dirname(CONFIG_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(servers, null, 2), "utf-8");

  // 同步刷新运行中的 manager
  const mgr = getMcpManager();
  const enabledServers = servers.filter((s) => s.enabled !== false);
  mgr.registerServers(enabledServers);
}

export async function probeMcpServer(config: MCPServerConfig): Promise<{
  ok: boolean;
  latencyMs: number;
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
    return {
      ok: true,
      latencyMs,
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
