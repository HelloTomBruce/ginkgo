import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppSwitcher } from "./AppSwitcher";
import type { AppDefinition } from "@/types/app";

const mockApps: AppDefinition[] = [
  {
    manifest: {
      id: "analytics",
      name: "智能数据分析师",
      description: "数据分析与图表生成",
      icon: "TrendingUp",
    },
    client: { welcomeMessage: "欢迎", presetQueries: [], hasWorkspace: true },
    server: { buildSystemPrompt: () => "analytics prompt" },
  },
  {
    manifest: {
      id: "general",
      name: "通用智能助手",
      description: "通用问答与代码工程",
      icon: "Bot",
    },
    client: { welcomeMessage: "欢迎", presetQueries: [] },
    server: { buildSystemPrompt: () => "general prompt" },
  },
];

describe("AppSwitcher 组件", () => {
  it("正确渲染当前激活的应用信息", () => {
    render(
      <AppSwitcher
        activeAppId="analytics"
        onSwitchApp={vi.fn()}
        apps={mockApps}
      />
    );

    expect(screen.getByText("智能数据分析师")).toBeDefined();
    expect(screen.getByText("数据分析与图表生成")).toBeDefined();
  });

  it("点击按钮可展开应用下拉菜单并支持切换", () => {
    const handleSwitch = vi.fn();
    render(
      <AppSwitcher
        activeAppId="analytics"
        onSwitchApp={handleSwitch}
        apps={mockApps}
      />
    );

    const button = screen.getByTestId("app-switcher-button");
    fireEvent.click(button);

    // 下拉框展开后能看到另一个应用
    const menu = screen.getByTestId("app-switcher-menu");
    expect(menu).toBeDefined();
    expect(screen.getByText("通用智能助手")).toBeDefined();

    // 点击切换应用
    const generalOption = screen.getByText("通用智能助手").closest("button");
    expect(generalOption).not.toBeNull();
    fireEvent.click(generalOption!);

    expect(handleSwitch).toHaveBeenCalledWith("general");
  });

  it("当下拉展开且传入 onOpenAppStore 时，渲染应用中心入口并可点击触发", () => {
    const handleOpenAppStore = vi.fn();
    render(
      <AppSwitcher
        activeAppId="analytics"
        onSwitchApp={vi.fn()}
        apps={mockApps}
        onOpenAppStore={handleOpenAppStore}
      />
    );

    const button = screen.getByTestId("app-switcher-button");
    fireEvent.click(button);

    const storeBtn = screen.getByTestId("open-app-store-button");
    expect(storeBtn).toBeDefined();
    expect(screen.getByText("探索与管理应用中心")).toBeDefined();

    fireEvent.click(storeBtn);
    expect(handleOpenAppStore).toHaveBeenCalled();
  });
});
