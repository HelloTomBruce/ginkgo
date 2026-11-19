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

  it("点击「注册 MCP 服务」打开宽表单弹窗，支持配置 HTTP Headers 与 Stdio Env 变量", async () => {
    render(<McpSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /注册 MCP 服务/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /注册 MCP 服务/ }));

    expect(screen.getByText("注册 MCP 服务器")).toBeInTheDocument();
    // 确认已移除预设快速填充
    expect(screen.queryByText("从常用生态预设快速填充：")).not.toBeInTheDocument();

    // 默认 SSE 模式下展示 HTTP 请求头 Headers 输入
    expect(screen.getByText(/HTTP 请求头 Headers/)).toBeInTheDocument();
    const headersInput = screen.getByPlaceholderText(/Authorization: Bearer/);
    fireEvent.change(headersInput, { target: { value: "Authorization: Bearer my-secret-token" } });
    expect(headersInput).toHaveValue("Authorization: Bearer my-secret-token");

    // 切换至 Stdio 本地进程模式
    const stdioRadio = screen.getByRole("radio", { name: /Stdio 本地进程/ });
    fireEvent.click(stdioRadio);

    // Stdio 模式下展示环境变量注入输入
    expect(screen.getByText(/环境变量注入 Environment Variables/)).toBeInTheDocument();
    const envInput = screen.getByPlaceholderText(/GITHUB_PERSONAL_ACCESS_TOKEN/);
    fireEvent.change(envInput, { target: { value: "GITHUB_TOKEN=ghp_test\nAPI_HOST=localhost" } });
    expect(envInput).toHaveValue("GITHUB_TOKEN=ghp_test\nAPI_HOST=localhost");
  });
});
