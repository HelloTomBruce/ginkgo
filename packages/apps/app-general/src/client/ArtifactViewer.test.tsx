/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ArtifactViewer } from "./ArtifactViewer";
import { buildFileTree } from "./fileTree";
import { extractBrowserOperations } from "./browser/browserOps";

describe("ArtifactViewer 多维工作台", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("buildFileTree: 组装层级树且目录在前按字母排序", () => {
    const rawItems = [
      { name: "b.ts", path: "src/b.ts", type: "file" as const, updatedAt: 1 },
      { name: "a.ts", path: "src/a.ts", type: "file" as const, updatedAt: 1 },
      { name: "components", path: "src/components", type: "directory" as const, updatedAt: 1 },
      { name: "Button.tsx", path: "src/components/Button.tsx", type: "file" as const, updatedAt: 1 },
      { name: "README.md", path: "README.md", type: "file" as const, updatedAt: 1 },
    ];

    const tree = buildFileTree(rawItems);
    expect(tree.length).toBe(2);
    expect(tree[0].name).toBe("src");
    expect(tree[0].type).toBe("directory");
    expect(tree[1].name).toBe("README.md");

    const srcChildren = tree[0].children;
    expect(srcChildren[0].name).toBe("components");
    expect(srcChildren[0].type).toBe("directory");
    expect(srcChildren[1].name).toBe("a.ts");
    expect(srcChildren[2].name).toBe("b.ts");
  });

  it("初始渲染展示文件树 Tab 与空态", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("action=git_status")) {
        return new Response(JSON.stringify({ isGitRepo: true, branch: "main", changes: [] }), {
          status: 200,
        });
      }
      if (String(url).includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} onClose={vi.fn()} />);

    expect(screen.getByText("文件")).toBeInTheDocument();
    expect(screen.getByText("Git 变更")).toBeInTheDocument();
    expect(screen.getByText("终端")).toBeInTheDocument();
    expect(screen.getByText("浏览器")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("暂无生成文件")).toBeInTheDocument();
    });
  });

  it("支持切换到 Git 变更 Tab 并展示变更文件", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("action=git_status")) {
        return new Response(
          JSON.stringify({
            isGitRepo: true,
            branch: "feat-test",
            changes: [
              {
                path: "src/main.ts",
                status: "modified",
                diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} onClose={vi.fn()} />);

    const gitTab = screen.getByText("Git 变更");
    fireEvent.click(gitTab);

    await waitFor(() => {
      expect(screen.getByText("分支: feat-test")).toBeInTheDocument();
      expect(screen.getByText("src/main.ts")).toBeInTheDocument();
      expect(screen.getByText("M")).toBeInTheDocument();
    });
  });

  it("支持切换到 终端 Tab 并执行命令", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            success: true,
            command: "pwd",
            stdout: "/workspace/general/sess_1",
            exitCode: 0,
            durationMs: 5,
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [], changes: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_1" onClose={vi.fn()} />);

    const termTab = screen.getByText("终端");
    fireEvent.click(termTab);

    expect(screen.getByText("沙箱命令行终端已就绪")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/在工作区沙箱执行 Shell 命令/);
    fireEvent.change(input, { target: { value: "pwd" } });

    const submitBtn = screen.getByRole("button", { name: /执行/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("/workspace/general/sess_1")).toBeInTheDocument();
    });
  });

  it("支持切换到 浏览器 Tab 并在无操作时展示空态", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (u.includes("/api/sessions")) {
        return new Response(JSON.stringify({ session: { messages: [] } }), { status: 200 });
      }
      if (u.includes("/api/apps/general/action")) {
        return new Response(JSON.stringify({ status: "ready", screenshots: [], downloads: [] }), {
          status: 200,
        });
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_1" onClose={vi.fn()} />);

    const browserTab = screen.getByText("浏览器");
    fireEvent.click(browserTab);

    await waitFor(() => {
      expect(screen.getByText("浏览器自动化协同已就绪")).toBeInTheDocument();
      expect(screen.getByText("未打开任何网页（等待会话浏览器交互）")).toBeInTheDocument();
    });
  });

  it("支持解析会话工具调用并展示浏览器流水与模拟地址栏", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (u.includes("/api/sessions")) {
        return new Response(
          JSON.stringify({
            session: {
              id: "sess_1",
              messages: [
                {
                  id: "m1",
                  role: "assistant",
                  toolInvocations: [
                    {
                      toolCallId: "call_1",
                      toolName: "browser_open",
                      args: { url: "https://example.com" },
                      result: {
                        success: true,
                        url: "https://example.com",
                        title: "Example Domain",
                      },
                    },
                    {
                      toolCallId: "call_2",
                      toolName: "browser_screenshot",
                      args: { filename: "example.png" },
                      result: {
                        success: true,
                        screenshotPath: "screenshots/example.png",
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/apps/general/action")) {
        return new Response(
          JSON.stringify({
            status: "ready",
            screenshots: [{ name: "example.png", path: "screenshots/example.png", updatedAt: 1000 }],
            downloads: [],
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_1" onClose={vi.fn()} />);

    const browserTab = screen.getByText("浏览器");
    fireEvent.click(browserTab);

    await waitFor(() => {
      // 验证地址栏与步骤卡片展示最新打开的网页 URL
      expect(screen.getAllByText("https://example.com").length).toBeGreaterThanOrEqual(1);
      // 验证页面标题
      expect(screen.getByText("Example Domain")).toBeInTheDocument();
      // 验证两个操作步骤已渲染
      expect(screen.getByText("打开网页")).toBeInTheDocument();
      expect(screen.getByText("网页截图")).toBeInTheDocument();
      // 验证步骤编号
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.getByText("#2")).toBeInTheDocument();
    });
  });

  it("当消息同时包含 toolInvocations 与 parts 具有相同 toolCallId 时，自动去重保证唯一渲染", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const duplicateCallId = "call_9ba759faf08345fbbd22e4a8";

    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (u.includes("/api/sessions")) {
        return new Response(
          JSON.stringify({
            session: {
              id: "sess_dup",
              messages: [
                {
                  id: "m_dup",
                  role: "assistant",
                  // AI SDK 会同时在消息顶层挂载 toolInvocations 与 parts 嵌套 toolInvocation
                  toolInvocations: [
                    {
                      toolCallId: duplicateCallId,
                      toolName: "browser_open",
                      args: { url: "https://news.ycombinator.com" },
                      result: { success: true, url: "https://news.ycombinator.com" },
                    },
                  ],
                  parts: [
                    {
                      type: "tool-invocation",
                      toolInvocation: {
                        toolCallId: duplicateCallId,
                        toolName: "browser_open",
                        args: { url: "https://news.ycombinator.com" },
                        result: { success: true, url: "https://news.ycombinator.com" },
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/apps/general/action")) {
        return new Response(JSON.stringify({ status: "ready", screenshots: [], downloads: [] }), {
          status: 200,
        });
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_dup" onClose={vi.fn()} />);

    const browserTab = screen.getByText("浏览器");
    fireEvent.click(browserTab);

    await waitFor(() => {
      // 验证去重后只有 1 次调用
      expect(screen.getByText("1 次调用")).toBeInTheDocument();
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.queryByText("#2")).not.toBeInTheDocument();
    });

    // 验证没有任何重复 key 警告
    const keyWarnings = errorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("Encountered two children with the same key"))
    );
    expect(keyWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("支持手动点击截取画面按钮并刷新展示", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (u.includes("/api/sessions")) {
        return new Response(
          JSON.stringify({
            session: {
              id: "sess_capture",
              messages: [
                {
                  id: "m_1",
                  role: "assistant",
                  parts: [
                    {
                      type: "tool-invocation",
                      toolInvocation: {
                        toolCallId: "c_open",
                        toolName: "browser_open",
                        args: { url: "https://www.google.com" },
                        result: { url: "https://www.google.com/", title: "Google" },
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/apps/general/action")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.action === "browser_capture_screenshot") {
          return new Response(
            JSON.stringify({
              success: true,
              screenshot: {
                name: "shot-now.png",
                path: "screenshots/shot-now.png",
                updatedAt: Date.now(),
              },
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            status: "ready",
            screenshots: [{ name: "shot-now.png", path: "screenshots/shot-now.png", updatedAt: 1000 }],
            downloads: [],
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_capture" onClose={vi.fn()} />);

    const browserTab = screen.getByText("浏览器");
    fireEvent.click(browserTab);

    await waitFor(() => {
      expect(screen.getByText("截取画面")).toBeInTheDocument();
    });

    const captureBtn = screen.getByText("截取画面");
    fireEvent.click(captureBtn);

    await waitFor(() => {
      expect(screen.getByText("screenshots/shot-now.png")).toBeInTheDocument();
    });
  });

  it("extractBrowserOperations: 正确解析 parts 与 toolInvocations 并提取相对截图路径", () => {
    const rawMsgs = [
      {
        id: "m_1",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolCallId: "call_a",
              toolName: "browser_open",
              args: { url: "https://github.com" },
              result: { url: "https://github.com", title: "GitHub" },
            },
          },
          {
            type: "tool-invocation",
            toolInvocation: {
              toolCallId: "call_b",
              toolName: "browser_screenshot",
              args: {},
              result: { path: "/abs/path/workspaces/general/sess/screenshots/shot.png" },
            },
          },
        ],
      },
    ];

    const ops = extractBrowserOperations(rawMsgs);
    expect(ops).toHaveLength(2);
    expect(ops[0].toolName).toBe("browser_open");
    expect(ops[0].url).toBe("https://github.com");
    expect(ops[1].toolName).toBe("browser_screenshot");
    expect(ops[1].screenshotPath).toBe("screenshots/shot.png");
  });

  it("宿主注入 live messages 时实现内存级零延迟实时自动上屏", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (u.includes("/api/sessions")) {
        // 服务端尚无消息（模拟流式正在生成，尚未存盘）
        return new Response(JSON.stringify({ session: { messages: [] } }), { status: 200 });
      }
      if (u.includes("/api/apps/general/action")) {
        return new Response(JSON.stringify({ status: "ready", screenshots: [], downloads: [] }), {
          status: 200,
        });
      }
      return new Response(null, { status: 404 });
    });

    const liveMessages = [
      {
        id: "msg_stream_1",
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolCallId: "c_live_1",
              toolName: "browser_open",
              args: { url: "https://news.ycombinator.com" },
              result: { url: "https://news.ycombinator.com", title: "Hacker News" },
            },
          },
          {
            type: "tool-invocation",
            toolInvocation: {
              toolCallId: "c_live_2",
              toolName: "browser_screenshot",
              args: {},
              result: { path: "screenshots/hn.png" },
            },
          },
        ],
      },
    ];

    const { rerender } = render(
      <ArtifactViewer
        data={null}
        sessionId="sess_live"
        messages={[]}
        isStreaming={true}
        onClose={vi.fn()}
      />
    );

    const browserTab = screen.getByText("浏览器");
    fireEvent.click(browserTab);

    // 初始空态
    expect(screen.getByText("浏览器自动化协同已就绪")).toBeInTheDocument();

    // 模拟流式分块到达：注入最新 messages
    rerender(
      <ArtifactViewer
        data={null}
        sessionId="sess_live"
        messages={liveMessages}
        isStreaming={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("https://news.ycombinator.com").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Hacker News")).toBeInTheDocument();
      expect(screen.getByText("screenshots/hn.png")).toBeInTheDocument();
      expect(screen.getByText("2 次调用")).toBeInTheDocument();
    });
  });
});
