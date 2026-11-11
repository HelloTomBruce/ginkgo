import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ModelSwitcher } from "./ModelSwitcher";
import type { ConfiguredProvider } from "@/lib/llmProviders";

const MOCK_PROVIDERS: ConfiguredProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "builtin",
    protocol: "openai",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: "sk-deepseek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    enabled: true,
  },
  {
    id: "custom-gate",
    name: "火山网关",
    type: "custom",
    protocol: "openai",
    baseURL: "https://gateway.example/v1",
    apiKey: "",
    models: ["doubao-pro", "doubao-lite"],
    defaultModel: "doubao-pro",
    enabled: true,
  },
];

afterEach(cleanup);

describe("ModelSwitcher", () => {
  it("默认渲染当前活跃 provider 与 model，并展示状态指示灯", () => {
    render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /切换模型/ })).toBeInTheDocument();
    expect(screen.getByText("DeepSeek / deepseek-chat")).toBeInTheDocument();
  });

  it("compact 模式（输入框场景）仅展示模型名，不展示 provider", () => {
    render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={vi.fn()}
        variant="compact"
      />
    );

    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.queryByText(/DeepSeek \//)).not.toBeInTheDocument();
  });

  it("点击触发按钮展开下拉菜单，展示各 provider 及所属模型列表", () => {
    render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: /切换模型/ });
    fireEvent.click(trigger);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("火山网关")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /deepseek-reasoner/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /doubao-pro/ })).toBeInTheDocument();
  });

  it("点击目标模型触发 onSwitchModel 并关闭下拉菜单", () => {
    const onSwitchModel = vi.fn();
    render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={onSwitchModel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /切换模型/ }));
    const targetOption = screen.getByRole("option", { name: /deepseek-reasoner/ });
    fireEvent.click(targetOption);

    expect(onSwitchModel).toHaveBeenCalledWith("deepseek", "deepseek-reasoner");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("点击底部「添加或管理模型提供商」触发 onOpenSettings", () => {
    const onOpenSettings = vi.fn();
    render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={vi.fn()}
        onOpenSettings={onOpenSettings}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /切换模型/ }));
    const manageBtn = screen.getByRole("button", { name: /添加或管理模型提供商/ });
    fireEvent.click(manageBtn);

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("compact 模式（输入框场景）弹层朝上弹出 (bottom-full)，header 模式朝下弹出 (top-full)", () => {
    // 1. compact 模式：朝上弹出
    const { unmount } = render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={vi.fn()}
        variant="compact"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /切换模型/ }));
    const compactListbox = screen.getByRole("listbox");
    expect(compactListbox.className).toContain("bottom-full");
    unmount();

    // 2. header 模式：朝下弹出
    render(
      <ModelSwitcher
        providers={MOCK_PROVIDERS}
        activeProviderId="deepseek"
        activeModel="deepseek-chat"
        onSwitchModel={vi.fn()}
        variant="header"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /切换模型/ }));
    const headerListbox = screen.getByRole("listbox");
    expect(headerListbox.className).toContain("top-full");
  });
});
