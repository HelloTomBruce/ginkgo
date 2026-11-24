// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DesignStudioViewer, buildFileTree, isDesignArtifact } from "./DesignStudioViewer";

afterEach(cleanup);

describe("DesignStudioViewer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/apps/design/action")) {
          return {
            ok: true,
            json: async () => ({
              hasCanvas: true,
              canvasTitle: "营销页面设计",
              boardCount: 2,
              boards: ["Main.dc.html", "Components.dc.html"],
              boardsDetail: [
                { key: "Main.dc.html", title: "主页面", width: 880, height: 560 },
                { key: "Components.dc.html", title: "组件画廊", width: 1200, height: 800 },
              ],
              dashboards: [
                {
                  id: "data:overview.dashboard.html",
                  title: "业务大盘",
                  path: "/tmp/mock/overview.dashboard.html",
                  relativePath: "dashboards/overview.dashboard.html",
                },
              ],
              previewUrl: "http://127.0.0.1:4791/design/mock/",
              systemPreviewUrl: "http://127.0.0.1:4792/system/mock/",
              hasDesignSystem: true,
              designSystem: { colors: { primary: "#38bdf8" } },
            }),
          };
        }
        if (url.includes("/api/workspace") && !url.includes("filePath=")) {
          return {
            ok: true,
            json: async () => ({
              files: [
                { name: "canvas.json", path: "project/canvas.json" },
                { name: "Main.dc.html", path: "project/Main.dc.html" },
              ],
            }),
          };
        }
        if (url.includes("/api/workspace") && url.includes("filePath=")) {
          return {
            ok: true,
            json: async () => ({
              content: '{"v":3,"title":"营销页面设计"}',
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      })
    );
  });

  it("默认渲染画板预览 Tab 并展示当前画板标题与 iframe", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    await waitFor(() => {
      expect(screen.getByText("营销页面设计")).toBeInTheDocument();
      expect(screen.getByText("2 个画板")).toBeInTheDocument();
    });

    // 检查 iframe
    const iframe = screen.getByTitle("Ginkgo Design Canvas Preview") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe("http://127.0.0.1:4791/design/mock/");
  });

  it("安全线：srcdoc 看板 iframe 严禁携带 allow-same-origin（防同源脚本访问宿主凭据）", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    // 切到数据看板 Tab 触发 srcdoc iframe 渲染
    fireEvent.click(screen.getByRole("button", { name: /数据看板/ }));

    const dashIframe = await screen.findByTitle(/Claude Data - 业务大盘/) as HTMLIFrameElement;
    expect(dashIframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(dashIframe.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("支持切换设备视口 (桌面/平板/手机)", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    const tabletBtn = screen.getByTitle("平板设备视口 (768px)");
    fireEvent.click(tabletBtn);

    const mobileBtn = screen.getByTitle("移动设备视口 (390px)");
    fireEvent.click(mobileBtn);

    const desktopBtn = screen.getByTitle("自适应桌面视口 (100%)");
    fireEvent.click(desktopBtn);
  });

  it("支持切换到设计系统 Tab 并默认展示交互预览 iframe，支持切到体检与 Tokens", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    const dsTabBtn = screen.getByRole("button", { name: /设计系统/ });
    fireEvent.click(dsTabBtn);

    // 默认展示交互预览 iframe
    const dsIframe = await screen.findByTitle("Ginkgo Design System Preview") as HTMLIFrameElement;
    expect(dsIframe).toBeInTheDocument();
    expect(dsIframe.src).toBe("http://127.0.0.1:4792/system/mock/");

    // 切换到体检与 Tokens 模式
    const auditBtn = screen.getByText("体检与 Tokens");
    fireEvent.click(auditBtn);

    expect(screen.getByText("Design Token 合规性体检")).toBeInTheDocument();
    expect(screen.getByText("全局 Design Tokens 概览")).toBeInTheDocument();
  });

  it("支持切换到源码与文件 Tab 并展示文件树", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    const filesTabBtn = screen.getByRole("button", { name: /源码与文件/ });
    fireEvent.click(filesTabBtn);

    await waitFor(() => {
      expect(screen.getByText("设计产物清单")).toBeInTheDocument();
      expect(screen.getAllByText("project/canvas.json").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("当提供 sessionId 时通过应用动作网关自动加载状态", async () => {
    render(<DesignStudioViewer sessionId="sess-test-auto" appId="design" />);

    await waitFor(() => {
      expect(screen.getByText("营销页面设计")).toBeInTheDocument();
      expect(screen.getByText("2 个画板")).toBeInTheDocument();
    });
  });

  it("支持画板多实例胶囊切换并在单板选中时提示聚焦", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    await waitFor(() => {
      expect(screen.getByText("主页面")).toBeInTheDocument();
      expect(screen.getByText("组件画廊")).toBeInTheDocument();
    });

    // 点击组件画廊单板
    const compBoardBtn = screen.getByText("组件画廊");
    fireEvent.click(compBoardBtn);

    await waitFor(() => {
      expect(screen.getByText(/聚焦画板：组件画廊/)).toBeInTheDocument();
      expect(screen.getByText(/1200×800px/)).toBeInTheDocument();
    });

    const iframe = screen.getByTitle("Ginkgo Design Canvas Preview") as HTMLIFrameElement;
    expect(iframe.src).toBe("http://127.0.0.1:4791/design/mock/project/Components.dc.html");

    // 切回全景画布
    const allBoardBtn = screen.getByText(/全景画布/);
    fireEvent.click(allBoardBtn);
    expect(screen.queryByText(/聚焦画板：组件画廊/)).not.toBeInTheDocument();
    expect(iframe.src).toBe("http://127.0.0.1:4791/design/mock/");
  });

  it("支持切换到数据看板 Tab 并展示 Claude Data 实例", async () => {
    render(<DesignStudioViewer sessionId="sess-viewer-test" appId="design" />);

    const dataTabBtn = screen.getByRole("button", { name: /数据看板/ });
    fireEvent.click(dataTabBtn);

    await waitFor(() => {
      expect(screen.getByText("业务大盘")).toBeInTheDocument();
    });
  });

  it("buildFileTree: 组装层级树且目录在前按字母排序", () => {
    const rawFiles = [
      { name: "canvas.json", path: "project/canvas.json" },
      { name: "Main.dc.html", path: "project/Main.dc.html" },
      { name: "overview.dashboard.html", path: "project/dashboards/overview.dashboard.html" },
      { name: "design-system.json", path: "project/design-system.json" },
    ];
    const tree = buildFileTree(rawFiles);
    // 根节点为 project/
    expect(tree[0].name).toBe("project");
    expect(tree[0].type).toBe("directory");
    expect(tree[0].children.length).toBe(4);
  });

  it("isDesignArtifact: 强制仅纳管 project/ 下产物，排除外部无关工程文件", () => {
    // project/ 目录下的所有设计产物（返回 true）
    expect(isDesignArtifact("project/canvas.json")).toBe(true);
    expect(isDesignArtifact("project/Main.dc.html")).toBe(true);
    expect(isDesignArtifact("project/support.js")).toBe(true);
    expect(isDesignArtifact("project/dashboards/sales.dashboard.html")).toBe(true);
    expect(isDesignArtifact("project/design-system.json")).toBe(true);
    expect(isDesignArtifact("project/tokens.json")).toBe(true);
    expect(isDesignArtifact("project/design-audit-report.json")).toBe(true);

    // 工作区根目录下未放在 project/ 内的文件及杂乱文件（一律返回 false）
    expect(isDesignArtifact("canvas.json")).toBe(false);
    expect(isDesignArtifact("dashboards/sales.dashboard.html")).toBe(false);
    expect(isDesignArtifact("design-system.json")).toBe(false);
    expect(isDesignArtifact("package.json")).toBe(false);
    expect(isDesignArtifact("tsconfig.json")).toBe(false);
    expect(isDesignArtifact(".env.local")).toBe(false);
    expect(isDesignArtifact("node_modules/react/index.js")).toBe(false);
    expect(isDesignArtifact("server.log")).toBe(false);
    expect(isDesignArtifact("pnpm-lock.yaml")).toBe(false);
  });
});
