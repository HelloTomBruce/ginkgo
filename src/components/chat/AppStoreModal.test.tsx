import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AppStoreModal } from "./AppStoreModal";
import { toast } from "@/lib/toast";

describe("AppStoreModal 应用中心组件", () => {
  const mockApps = [
    {
      id: "analytics",
      name: "智能数据分析",
      description: "数据分析描述",
      icon: "TrendingUp",
      category: "数据智能",
      enabled: true,
      builtin: true,
      isRegistered: true,
      health: { healthy: true, status: "ready", message: "就绪" },
    },
    {
      id: "design",
      name: "体验设计工坊",
      description: "设计描述",
      icon: "Palette",
      category: "体验设计",
      enabled: true,
      builtin: false,
      isRegistered: true,
      health: {
        healthy: false,
        status: "missing_deps",
        missingCapabilities: ["cli:claude-data"],
        remediationGuide: "npm install -g claude-data",
        message: "缺少工具",
      },
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/apps") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ apps: mockApps }),
        });
      }
      if (url.includes("/toggle")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it("打开弹窗时正常请求 /api/apps 并渲染应用列表", async () => {
    render(<AppStoreModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("智能数据分析")).toBeDefined();
      expect(screen.getByText("体验设计工坊")).toBeDefined();
    });

    expect(screen.getByText("能力就绪")).toBeDefined();
    expect(screen.getByText("依赖缺失 (点击自愈)")).toBeDefined();
  });

  it("点击启停开关调用 toggle 接口", async () => {
    render(<AppStoreModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("智能数据分析")).toBeDefined();
    });

    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);

    fireEvent.click(switches[0]);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/apps/analytics/toggle",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("搜索输入框能实时筛选应用", async () => {
    render(<AppStoreModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("智能数据分析")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText(/搜索应用名称/);
    fireEvent.change(searchInput, { target: { value: "体验设计" } });

    expect(screen.queryByText("智能数据分析")).toBeNull();
    expect(screen.getByText("体验设计工坊")).toBeDefined();
  });

  it("点击依赖缺失徽标展示自愈命令指引", async () => {
    render(<AppStoreModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("依赖缺失 (点击自愈)")).toBeDefined();
    });

    fireEvent.click(screen.getByText("依赖缺失 (点击自愈)"));
    expect(screen.getByText("npm install -g claude-data")).toBeDefined();
  });

  it("打开弹窗只发起一次 GET /api/apps（取数逻辑仅一份）", async () => {
    render(<AppStoreModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("智能数据分析")).toBeDefined();
    });

    const appListCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => call[0] === "/api/apps");
    expect(appListCalls).toHaveLength(1);
  });

  it("启停失败时弹出错误提示，且开关状态不被乐观更新", async () => {
    const errorSpy = vi.spyOn(toast, "error");
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/apps") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ apps: mockApps }),
        });
      }
      if (url.includes("/toggle")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "配置已损坏" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as unknown as typeof fetch;

    render(<AppStoreModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("智能数据分析")).toBeDefined();
    });

    const switchBefore = screen.getAllByRole("switch")[0];
    expect(switchBefore.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(switchBefore);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("配置已损坏"));
    // 失败不做乐观更新
    expect(
      screen.getAllByRole("switch")[0].getAttribute("aria-checked")
    ).toBe("true");
  });

  it("未注册应用展示「载入失败」并可在指引面板看到具体原因", async () => {
    const brokenApp = {
      ...mockApps[1],
      id: "demo",
      name: "演示插件",
      builtin: false,
      isRegistered: false,
      loadError: "无法在插件目录解析包 \"@demo/app\"",
      health: { healthy: false, status: "missing_deps", message: "应用未注册" },
    };
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/apps") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ apps: [brokenApp] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as unknown as typeof fetch;

    render(<AppStoreModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("载入失败 (点击查看)")).toBeDefined();
    });

    fireEvent.click(screen.getByText("载入失败 (点击查看)"));
    expect(screen.getByText(/无法在插件目录解析包/)).toBeDefined();
  });
});
