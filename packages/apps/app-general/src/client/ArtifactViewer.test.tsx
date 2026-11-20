/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ArtifactViewer } from "./ArtifactViewer";

describe("ArtifactViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
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
});
