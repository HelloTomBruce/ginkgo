import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { McpSettings } from "./McpSettings";

const mockServers = [
  {
    id: "gitlab-mcp",
    name: "GitLab 协同",
    transport: "stdio" as const,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    enabled: true,
  },
  {
    id: "zentao-mcp",
    name: "ZenTao 禅道",
    transport: "sse" as const,
    url: "http://localhost:8080/sse",
    enabled: false,
  },
];

describe("McpSettings Component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/mcp") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ servers: mockServers }),
          });
        }
        if (url === "/api/mcp/probe") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              latencyMs: 28,
              tools: [{ name: "search_issues", description: "Search issues" }],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("渲染 MCP 服务器列表卡片与状态徽章", async () => {
    render(<McpSettings />);

    await waitFor(() => {
      expect(screen.getByText("GitLab 协同")).toBeInTheDocument();
      expect(screen.getByText("ZenTao 禅道")).toBeInTheDocument();
    });

    expect(screen.getByText("Stdio 进程")).toBeInTheDocument();
    expect(screen.getByText("SSE / HTTP")).toBeInTheDocument();
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });

  it("点击「测试探活」触发探活并展开扫描到的 Tools", async () => {
    render(<McpSettings />);

    await waitFor(() => {
      expect(screen.getByText("GitLab 协同")).toBeInTheDocument();
    });

    const probeButtons = screen.getAllByRole("button", { name: /测试探活/ });
    fireEvent.click(probeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/连通正常（耗时 28ms）/)).toBeInTheDocument();
      expect(screen.getByText("search_issues")).toBeInTheDocument();
    });
  });

  it("点击「注册 MCP 服务」打开表单弹窗，支持预设模板填充", async () => {
    render(<McpSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /注册 MCP 服务/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /注册 MCP 服务/ }));

    expect(screen.getByText("注册 MCP 服务器")).toBeInTheDocument();
    expect(screen.getByText("从常用生态预设快速填充：")).toBeInTheDocument();

    // 点击 GitHub 预设填充
    const githubBtn = screen.getByRole("button", { name: "GitHub 代码协同" });
    fireEvent.click(githubBtn);

    expect(screen.getByDisplayValue("github")).toBeInTheDocument();
    expect(screen.getByDisplayValue("GitHub 代码协同")).toBeInTheDocument();
  });
});
