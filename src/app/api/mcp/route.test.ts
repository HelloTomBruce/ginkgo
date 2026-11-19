// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";
import { POST as POST_PROBE } from "./probe/route";
import * as mcpStore from "@/lib/mcpStore";

describe("MCP API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/mcp", () => {
    it("成功返回已配置的 MCP Servers 及其连接状态", async () => {
      vi.spyOn(mcpStore, "loadMcpServers").mockResolvedValue([
        {
          id: "test-mcp",
          name: "Test MCP",
          transport: "sse",
          url: "http://localhost:8080/sse",
          enabled: true,
        },
      ]);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.servers).toHaveLength(1);
      expect(data.servers[0].id).toBe("test-mcp");
      expect(data.servers[0].status).toBeDefined();
    });
  });

  describe("POST /api/mcp", () => {
    it("缺少必要参数时返回 400", async () => {
      const req = new Request("http://localhost:3006/api/mcp", {
        method: "POST",
        body: JSON.stringify({ name: "Invalid" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("必须包含 id 与 transport");
    });

    it("成功保存并返回 200", async () => {
      vi.spyOn(mcpStore, "loadMcpServers").mockResolvedValue([]);
      const saveSpy = vi.spyOn(mcpStore, "saveMcpServers").mockResolvedValue();

      const serverPayload = {
        id: "new-server",
        name: "New Server",
        transport: "stdio" as const,
        command: "npx",
        args: ["-y", "@test/mcp"],
      };

      const req = new Request("http://localhost:3006/api/mcp", {
        method: "POST",
        body: JSON.stringify(serverPayload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(saveSpy).toHaveBeenCalledWith([
        expect.objectContaining({ id: "new-server", enabled: true }),
      ]);
    });
  });

  describe("DELETE /api/mcp", () => {
    it("缺少 id 参数时返回 400", async () => {
      const req = new Request("http://localhost:3006/api/mcp");
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it("成功删除对应 server", async () => {
      vi.spyOn(mcpStore, "loadMcpServers").mockResolvedValue([
        { id: "del-1", transport: "sse", url: "http://localhost" },
        { id: "del-2", transport: "sse", url: "http://localhost" },
      ]);
      const saveSpy = vi.spyOn(mcpStore, "saveMcpServers").mockResolvedValue();

      const req = new Request("http://localhost:3006/api/mcp?id=del-1");
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(saveSpy).toHaveBeenCalledWith([
        expect.objectContaining({ id: "del-2" }),
      ]);
    });
  });

  describe("POST /api/mcp/probe", () => {
    it("缺少参数时返回 400", async () => {
      const req = new Request("http://localhost:3006/api/mcp/probe", {
        method: "POST",
        body: JSON.stringify({ id: "no-transport" }),
      });
      const res = await POST_PROBE(req);
      expect(res.status).toBe(400);
    });

    it("返回探活与工具探测结果", async () => {
      vi.spyOn(mcpStore, "probeMcpServer").mockResolvedValue({
        ok: true,
        latencyMs: 35,
        tools: [{ name: "search_bugs", description: "Search bugs" }],
      });

      const req = new Request("http://localhost:3006/api/mcp/probe", {
        method: "POST",
        body: JSON.stringify({
          id: "zentao",
          transport: "sse",
          url: "http://localhost:8080/sse",
        }),
      });

      const res = await POST_PROBE(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.latencyMs).toBe(35);
      expect(data.tools).toHaveLength(1);
    });
  });
});
