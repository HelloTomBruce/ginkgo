// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DesignStudioViewer } from "./DesignStudioViewer";

afterEach(cleanup);

describe("DesignStudioViewer", () => {
  const mockWorkspace = {
    id: "ws-design-1",
    name: "营销页面设计",
    path: "/tmp/mock-workspace",
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/design")) {
          return {
            ok: true,
            json: async () => ({
              hasCanvas: true,
              canvasTitle: "营销页面设计",
              boardCount: 2,
              previewUrl: "http://127.0.0.1:4791/design/mock/",
              hasDesignSystem: true,
              designSystem: { colors: { primary: "#38bdf8" } },
            }),
          };
        }
        if (url.includes("/api/workspace?action=tree")) {
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
        if (url.includes("/api/workspace?action=file")) {
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
    render(<DesignStudioViewer workspace={mockWorkspace} />);

    await waitFor(() => {
      expect(screen.getByText("营销页面设计")).toBeInTheDocument();
      expect(screen.getByText("2 个画板")).toBeInTheDocument();
    });

    // 检查 iframe
    const iframe = screen.getByTitle("Ginkgo Design Canvas Preview") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe("http://127.0.0.1:4791/design/mock/");
  });

  it("支持切换设备视口 (桌面/平板/手机)", async () => {
    render(<DesignStudioViewer workspace={mockWorkspace} />);

    const tabletBtn = screen.getByTitle("平板设备视口 (768px)");
    fireEvent.click(tabletBtn);

    const mobileBtn = screen.getByTitle("移动设备视口 (390px)");
    fireEvent.click(mobileBtn);

    const desktopBtn = screen.getByTitle("自适应桌面视口 (100%)");
    fireEvent.click(desktopBtn);
  });

  it("支持切换到设计系统 Tab 并展示 Tokens", async () => {
    render(<DesignStudioViewer workspace={mockWorkspace} />);

    const dsTabBtn = screen.getByRole("button", { name: /设计系统/ });
    fireEvent.click(dsTabBtn);

    expect(screen.getByText("Design Token 合规性体检 (Audit)")).toBeInTheDocument();
    expect(screen.getByText("全局 Design Tokens 概览")).toBeInTheDocument();
  });

  it("支持切换到源码与文件 Tab 并展示文件树", async () => {
    render(<DesignStudioViewer workspace={mockWorkspace} />);

    const filesTabBtn = screen.getByRole("button", { name: /源码与文件/ });
    fireEvent.click(filesTabBtn);

    await waitFor(() => {
      expect(screen.getByText("设计产物清单")).toBeInTheDocument();
      expect(screen.getAllByText("project/canvas.json").length).toBeGreaterThanOrEqual(1);
    });
  });
});
