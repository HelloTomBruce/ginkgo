import { describe, expect, it, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCPClientManager } from "./clientManager";
import { adaptMcpToolToCoreTool, getCoreToolsFromMcp } from "./toolAdapter";
import type { MCPServerConfig } from "./types";

describe("MCPClientManager & ToolAdapter", () => {
  it("注册配置并正确反馈初始状态", () => {
    const manager = new MCPClientManager();
    const config: MCPServerConfig = {
      id: "git-server",
      transport: "stdio",
      command: "git-mcp",
    };

    manager.registerServer(config);
    const statuses = manager.getAllStatus();

    expect(statuses).toHaveLength(1);
    expect(statuses[0].serverId).toBe("git-server");
    expect(statuses[0].connected).toBe(false);
    expect(statuses[0].transport).toBe("stdio");
  });

  it("adaptMcpToolToCoreTool 正确添加前缀与执行调用 (JSON 结果自动反序列化)", async () => {
    const manager = new MCPClientManager();
    const mockCallTool = vi
      .spyOn(manager, "callTool")
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({ commit: "abcdef", author: "alice" }),
          },
        ],
      });

    const mcpTool = {
      name: "get_latest_commit",
      description: "获取最新提交记录",
      inputSchema: { type: "object", properties: {} },
    };

    const coreTool = adaptMcpToolToCoreTool(
      mcpTool as never,
      "github",
      manager,
      { id: "github", transport: "stdio", prefixToolName: true }
    );

    expect(coreTool.description).toBe("获取最新提交记录");
    const result = await coreTool.execute?.({ repo: "my-repo" }, {} as never);

    expect(mockCallTool).toHaveBeenCalledWith("github", "get_latest_commit", {
      repo: "my-repo",
    });
    expect(result).toEqual({ commit: "abcdef", author: "alice" });
  });

  it("当 MCP 工具返回 isError 为 true 时，抛出明确异常", async () => {
    const manager = new MCPClientManager();
    vi.spyOn(manager, "callTool").mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Repository not found: 404" }],
    });

    const mcpTool = {
      name: "get_repo",
      description: "查询仓库",
      inputSchema: { type: "object", properties: {} },
    };

    const coreTool = adaptMcpToolToCoreTool(mcpTool as never, "gh", manager);

    await expect(coreTool.execute?.({}, {} as never)).rejects.toThrow(
      /Repository not found: 404/
    );
  });

  it("getCoreToolsFromMcp 批量扫描并装配工具集，遵循 allowedTools 白名单", async () => {
    const manager = new MCPClientManager();
    vi.spyOn(manager, "listTools").mockImplementation(async (serverId) => {
      if (serverId === "server1") {
        return [
          { name: "toolA", inputSchema: { type: "object" } },
          { name: "toolB", inputSchema: { type: "object" } },
        ] as never[];
      }
      return [{ name: "toolC", inputSchema: { type: "object" } }] as never[];
    });

    const configs: MCPServerConfig[] = [
      { id: "server1", transport: "stdio", prefixToolName: true },
      { id: "server2", transport: "stdio", prefixToolName: false },
    ];

    const tools = await getCoreToolsFromMcp(manager, configs);

    expect(Object.keys(tools)).toEqual(["server1_toolA", "server1_toolB", "toolC"]);
  });

  it("单 Server 发生异常时不破坏其他 Server 工具的挂载", async () => {
    const manager = new MCPClientManager();
    vi.spyOn(manager, "listTools").mockImplementation(async (serverId) => {
      if (serverId === "broken-server") {
        throw new Error("Connection refused");
      }
      return [{ name: "ping", inputSchema: { type: "object" } }] as never[];
    });

    const configs: MCPServerConfig[] = [
      { id: "broken-server", transport: "stdio" },
      { id: "healthy-server", transport: "stdio" },
    ];

    const tools = await getCoreToolsFromMcp(manager, configs);

    expect(tools["broken-server_ping"]).toBeUndefined();
    expect(tools["healthy-server_ping"]).toBeDefined();
  });

  describe("HTTP 传输智能自适应协商 (SSE <-> Streamable HTTP)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("当配置为 sse 但服务端报错 400 Mcp-Session-Id 时，自动协商并切换为 streamable_http", async () => {
      const manager = new MCPClientManager();
      manager.registerServer({
        id: "gitlab-test",
        transport: "sse",
        url: "http://127.0.0.1:5002/mcp",
      });

      // 模拟 Client.prototype.connect：当传入 SSEClientTransport 时报 400，当传入 StreamableHTTPClientTransport 时成功
      vi.spyOn(Client.prototype, "connect").mockImplementation(async function (
        this: Client,
        transport: unknown
      ) {
        if (transport instanceof SSEClientTransport) {
          throw new Error("SSE error: Non-200 status code (400)");
        }
        if (transport instanceof StreamableHTTPClientTransport) {
          return;
        }
      });

      vi.spyOn(Client.prototype, "listTools").mockResolvedValue({
        tools: [
          { name: "get_merge_request", inputSchema: { type: "object" } },
          { name: "search_repositories", inputSchema: { type: "object" } },
        ] as never[],
      });

      const client = await manager.getClient("gitlab-test");
      expect(client).toBeDefined();

      const status = manager.getStatus("gitlab-test");
      expect(status?.connected).toBe(true);
      expect(status?.transport).toBe("streamable_http");
      expect(status?.toolCount).toBe(2);

      const tools = await manager.listTools("gitlab-test");
      expect(tools.map((t) => t.name)).toEqual([
        "get_merge_request",
        "search_repositories",
      ]);
    });

    it("当配置为 streamable_http 但服务端报错 405 时，自动协商并降级为 sse", async () => {
      const manager = new MCPClientManager();
      manager.registerServer({
        id: "legacy-server",
        transport: "streamable_http",
        url: "http://127.0.0.1:8080/sse",
      });

      vi.spyOn(Client.prototype, "connect").mockImplementation(async function (
        this: Client,
        transport: unknown
      ) {
        if (transport instanceof StreamableHTTPClientTransport) {
          throw new Error("HTTP error 405 Method Not Allowed");
        }
        if (transport instanceof SSEClientTransport) {
          return;
        }
      });

      vi.spyOn(Client.prototype, "listTools").mockResolvedValue({
        tools: [{ name: "legacy_tool", inputSchema: { type: "object" } }] as never[],
      });

      await manager.getClient("legacy-server");
      const status = manager.getStatus("legacy-server");
      expect(status?.connected).toBe(true);
      expect(status?.transport).toBe("sse");
      expect(status?.toolCount).toBe(1);
    });

    it("当两种 HTTP 协议均连接失败时，抛出包含双向协商尝试详情的明确异常", async () => {
      const manager = new MCPClientManager();
      manager.registerServer({
        id: "dead-server",
        transport: "sse",
        url: "http://127.0.0.1:9999/mcp",
      });

      vi.spyOn(Client.prototype, "connect").mockImplementation(async function (
        this: Client,
        transport: unknown
      ) {
        if (transport instanceof SSEClientTransport) {
          throw new Error("ECONNREFUSED 127.0.0.1:9999");
        }
        if (transport instanceof StreamableHTTPClientTransport) {
          throw new Error("ECONNREFUSED 127.0.0.1:9999");
        }
      });

      await expect(manager.getClient("dead-server")).rejects.toThrow(
        /\[MCP\] 连接服务 \[dead-server\] 失败 \(尝试 sse: .*；尝试 streamable_http: .*\)/
      );

      const status = manager.getStatus("dead-server");
      expect(status?.connected).toBe(false);
      expect(status?.lastError).toContain("ECONNREFUSED");
    });
  });
});
