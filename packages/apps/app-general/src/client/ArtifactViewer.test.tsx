/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ArtifactViewer, buildFileTree } from "./ArtifactViewer";

describe("ArtifactViewer", () => {
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
    expect(tree.length).toBe(2); // src 目录与 README.md
    expect(tree[0].name).toBe("src");
    expect(tree[0].type).toBe("directory");
    expect(tree[1].name).toBe("README.md");

    // src 内部：components 目录在前，然后是 a.ts, b.ts
    const srcChildren = tree[0].children;
    expect(srcChildren[0].name).toBe("components");
    expect(srcChildren[0].type).toBe("directory");
    expect(srcChildren[1].name).toBe("a.ts");
    expect(srcChildren[2].name).toBe("b.ts");
  });

  it("初始渲染展示产物标题与空态", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/workspace")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} onClose={vi.fn()} />);

    expect(screen.getByText(/工作区产物/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("暂无生成文件")).toBeInTheDocument();
    });
  });

  it("拉取到文件时列出文件并展示选中内容", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("filePath=src%2Findex.ts") || u.includes("filePath=src/index.ts")) {
        return new Response(
          JSON.stringify({
            path: "src/index.ts",
            content: "console.log('hello world');",
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/workspace")) {
        return new Response(
          JSON.stringify({
            files: [
              {
                name: "index.ts",
                path: "src/index.ts",
                type: "file",
                updatedAt: Date.now(),
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText("src/index.ts").length).toBeGreaterThan(0);
      expect(screen.getByText("console.log('hello world');")).toBeInTheDocument();
    });
  });

  it("点击关闭与切换最大化回调正确触发", async () => {
    const handleClose = vi.fn();
    const handleToggleExpand = vi.fn();

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ files: [] }), { status: 200 })
    );

    render(
      <ArtifactViewer
        data={null}
        onClose={handleClose}
        onToggleExpand={handleToggleExpand}
      />
    );

    const closeBtn = screen.getByTitle("关闭工作区");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    const expandBtn = screen.getByTitle("全屏最大化");
    fireEvent.click(expandBtn);
    expect(handleToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("点击文件夹节点可折叠与展开其子项", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/workspace")) {
        return new Response(
          JSON.stringify({
            files: [
              { name: "src", path: "src", type: "directory", updatedAt: 1 },
              { name: "index.ts", path: "src/index.ts", type: "file", updatedAt: 1 },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<ArtifactViewer data={null} sessionId="sess_tree" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
      expect(screen.getByText("index.ts")).toBeInTheDocument();
    });

    // 点击 src 文件夹折叠
    const folderEl = screen.getByText("src");
    fireEvent.click(folderEl);

    // 子节点 index.ts 被隐藏
    expect(screen.queryByText("index.ts")).toBeNull();

    // 再次点击展开
    fireEvent.click(folderEl);
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });
});
