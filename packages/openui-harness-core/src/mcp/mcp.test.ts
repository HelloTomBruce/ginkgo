import { describe, expect, it, vi } from "vitest";
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
});
