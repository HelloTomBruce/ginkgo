/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ArtifactViewer, buildFileTree } from "./ArtifactViewer";

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
});
