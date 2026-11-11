import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "./SettingsModal";
import type { ConfiguredProvider } from "@/lib/llmProviders";

// mock /api/datasources：返回一个健康数据源，锁定「数据源」tab 状态渲染
const fetchMock = vi.fn().mockResolvedValue({
  json: async () => ({
    sources: [
      { id: "zentao", name: "ZenTao MCP", kind: "zentao-cli", tools: ["search_bugs"] },
    ],
    health: { zentao: { ok: true, latencyMs: 42 } },
  }),
});

function renderModal(props: Partial<SettingsModalProps> = {}) {
  return render(
    <SettingsModal
      providerId="custom"
      apiKey="sk-test"
      baseURL="https://api.openai.com/v1"
      model="gpt-4o-mini"
      accessToken=""
      temperature="0.2"
      maxTokens=""
      protocol="openai"
      onProviderChange={vi.fn()}
      onApiKeyChange={vi.fn()}
      onBaseURLChange={vi.fn()}
      onModelChange={vi.fn()}
      onAccessTokenChange={vi.fn()}
      onTemperatureChange={vi.fn()}
      onMaxTokensChange={vi.fn()}
      onProtocolChange={vi.fn()}
      onSave={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

afterEach(cleanup);

describe("SettingsModal tab 布局", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("标题为「设置」，含模型配置 / 数据源两个 tab", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据源" })).toBeInTheDocument();
  });

  it("默认展示模型配置面板，数据源内容不渲染", () => {
    renderModal();
    expect(screen.getByRole("tabpanel", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveValue("sk-test");
    expect(screen.queryByLabelText(/GitLab MCP Endpoint/)).not.toBeInTheDocument();
  });

  it("点击「数据源」tab 切换面板，展示数据源列表与探活状态", async () => {
    renderModal();
    const tab = screen.getByRole("tab", { name: "数据源" });
    // Radix Tabs 在 mousedown 激活（真实浏览器点击天然携带）
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);

    // 数据源列表由 DatasourceSettings 经 /api/datasources 渲染（mock 返回 ZenTao MCP）
    await waitFor(() => {
      expect(screen.getByText("ZenTao MCP")).toBeInTheDocument();
      expect(screen.getByText("42ms")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /添加数据源/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "数据源" })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("焦点移入「数据源」tab 自动激活面板（Radix Tabs 自动激活模式）", () => {
    renderModal();
    // 注：Radix RovingFocus 的方向键导航在 jsdom 中不生效（真实浏览器正常），
    // 方向键移焦后由 onFocus 自动激活——此处直接验证该激活语义
    const tab = screen.getByRole("tab", { name: "数据源" });
    fireEvent.focus(tab);
    expect(
      screen.getByRole("button", { name: /添加数据源/ })
    ).toBeInTheDocument();
  });

  it("底部按钮触发 onClose / onSave", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    renderModal({ onSave, onClose });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsModal Provider 预设", () => {
  it("Provider 下拉含全部预设与「自定义」", async () => {
    renderModal();

    // shadcn Select（Radix）：选项渲染在打开后的 listbox 弹层中
    const trigger = screen.getByLabelText(/Provider/);
    fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
    fireEvent.click(trigger);
    // 内置精选 10 项（无网络环境目录拉取失败回退内置）+ 自定义
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(11);
    expect(
      screen.getByRole("option", { name: "Kimi（Moonshot）" })
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "自定义" })).toBeInTheDocument();
  });

  it("预设 Provider 时 Model 为手输输入框 + datalist 建议（非强约束下拉）", () => {
    renderModal({
      providerId: "deepseek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
    const modelInput = screen.getByLabelText(
      /Model（手动输入/
    ) as HTMLInputElement;
    expect(modelInput.tagName).toBe("INPUT");
    expect(modelInput.value).toBe("deepseek-chat");
    expect(modelInput).toHaveAttribute("list", "settings-model-options");
    const datalist = document.getElementById(
      "settings-model-options"
    ) as HTMLDataListElement;
    const values = Array.from(datalist.options).map((o) => o.value);
    expect(values).toContain("deepseek-reasoner");
    expect(values).toContain("deepseek-chat");
  });

  it("自定义 Provider 时无 datalist，协议与 Base URL 直接展开可见", () => {
    renderModal({ providerId: "custom" });
    const modelInput = screen.getByLabelText(
      /Model（手动输入/
    ) as HTMLInputElement;
    expect(modelInput).not.toHaveAttribute("list");
    expect(
      document.getElementById("settings-model-options")
    ).not.toBeInTheDocument();
    // 自定义场景：协议与 Base URL 不藏在折叠区
    expect(screen.queryByText(/高级：协议与接口地址/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /OpenAI 兼容/i })).toBeChecked();
  });

  it("预设 Provider 时协议与 Base URL 收进高级折叠区，且字段存在", () => {
    renderModal({ providerId: "deepseek" });
    expect(screen.getByText(/高级：协议与接口地址/)).toBeInTheDocument();
    // 折叠区内字段仍在 DOM（details 未展开亦可查询）
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
  });

  it("API Key 占位符随 Provider 预设变化", () => {
    renderModal({ providerId: "deepseek" });
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "placeholder",
      "platform.deepseek.com 获取 sk-..."
    );
  });
});

describe("SettingsModal 协议类型", () => {
  it("默认选中 OpenAI 兼容，baseURL 占位符为 OpenAI 形态", () => {
    renderModal();

    const openaiBtn = screen.getByRole("radio", { name: /OpenAI 兼容/i });
    const anthropicBtn = screen.getByRole("radio", { name: /Anthropic/i });
    expect(openaiBtn).toBeChecked();
    expect(anthropicBtn).not.toBeChecked();
    expect(screen.getByLabelText(/Base URL/i)).toHaveAttribute(
      "placeholder",
      "https://api.openai.com/v1"
    );
  });

  it("点击 Anthropic 调用 onProtocolChange('anthropic')，占位符随 protocol 切换为 Anthropic 形态", () => {
    const onProtocolChange = vi.fn();
    renderModal({ onProtocolChange });

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/i }));

    expect(onProtocolChange).toHaveBeenCalledWith("anthropic");

    // 受控组件：以 protocol="anthropic" 重渲染后占位符切换
    cleanup();
    renderModal({ protocol: "anthropic" });
    expect(screen.getByLabelText(/Base URL/i)).toHaveAttribute(
      "placeholder",
      "https://api.kimi.com/coding"
    );
  });

  it("上下文窗口大小：留空时展示「自动推断」，填入值时触发变更回调并展示对应 k 数", () => {
    const onContextWindowChange = vi.fn();
    renderModal({ contextWindow: "", onContextWindowChange });

    expect(screen.getByText("自动推断")).toBeInTheDocument();
    const input = screen.getByLabelText(/上下文窗口大小/);
    expect(input).toHaveValue(null);

    fireEvent.change(input, { target: { value: "1024000" } });
    expect(onContextWindowChange).toHaveBeenCalledWith("1024000");

    cleanup();
    renderModal({ contextWindow: "1024000" });
    expect(screen.getByText("1024k")).toBeInTheDocument();
  });

  it("最大步数上限：留空时展示「默认 25 步」，填入值时触发变更回调并展示自定义步数", () => {
    const onMaxStepsChange = vi.fn();
    renderModal({ maxSteps: "", onMaxStepsChange });

    expect(screen.getByText("默认 25 步")).toBeInTheDocument();
    const input = screen.getByLabelText(/最大步数上限/);
    expect(input).toHaveValue(null);

    fireEvent.change(input, { target: { value: "35" } });
    expect(onMaxStepsChange).toHaveBeenCalledWith("35");

    cleanup();
    renderModal({ maxSteps: "35" });
    expect(screen.getByText("35 步")).toBeInTheDocument();
  });
});

describe("SettingsModal 多 Provider 管理能力（参考 dsh）", () => {
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
      name: "火山",
      type: "custom",
      protocol: "openai",
      baseURL: "https://gateway.example/v1",
      apiKey: "",
      models: ["doubao-lite"],
      defaultModel: "doubao-lite",
      enabled: true,
    },
  ];

  it("当提供 providers 时渲染多提供商卡片列表与状态指示", () => {
    renderModal({
      providers: MOCK_PROVIDERS,
      activeProviderId: "deepseek",
      activeModel: "deepseek-chat",
      onSaveProvider: vi.fn(),
    });

    expect(screen.getByText("填入各提供商的 API 密钥即可使用其模型。")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("火山")).toBeInTheDocument();
    expect(screen.getByText("自定义")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加模型提供商" })).toBeInTheDocument();
  });

  it("点击「添加模型提供商」进入第三方与自定义 API 切换面板", () => {
    renderModal({
      providers: MOCK_PROVIDERS,
      onSaveProvider: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "添加模型提供商" }));
    expect(screen.getByRole("button", { name: "第三方模型提供商" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义模型 API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建提供商" })).toBeInTheDocument();
  });

  it("编辑已有提供商时可修改 API 密钥与模型列表并保存", () => {
    const onSaveProvider = vi.fn();
    renderModal({
      providers: MOCK_PROVIDERS,
      onSaveProvider,
    });

    const editBtns = screen.getAllByRole("button", { name: "编辑" });
    fireEvent.click(editBtns[0]); // 编辑 DeepSeek

    expect(screen.getByText("留空使用已保存凭据")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSaveProvider).toHaveBeenCalledTimes(1);
    expect(onSaveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "deepseek",
        name: "DeepSeek",
      })
    );
  });

  it("删除提供商走行内二次确认，不触发原生 confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onDeleteProvider = vi.fn();
    renderModal({
      providers: MOCK_PROVIDERS,
      onSaveProvider: vi.fn(),
      onDeleteProvider,
    });

    const deleteBtns = screen.getAllByRole("button", { name: "删除" });
    fireEvent.click(deleteBtns[0]);

    // 不应调用 window.confirm
    expect(confirmSpy).not.toHaveBeenCalled();
    // 呈现行内确认
    expect(screen.getByText("确认删除？")).toBeInTheDocument();
    expect(onDeleteProvider).not.toHaveBeenCalled();

    // 点击「确认」触发删除
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onDeleteProvider).toHaveBeenCalledWith("deepseek");

    confirmSpy.mockRestore();
  });

  it("模型目录支持独立配置与展示每个模型的上下文窗口与最大输出 Tokens", () => {
    const onSaveProvider = vi.fn();
    const providersWithModelParams: ConfiguredProvider[] = [
      {
        id: "deepseek",
        name: "DeepSeek",
        type: "builtin",
        protocol: "openai",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: "sk-deepseek",
        models: [
          { id: "deepseek-chat", contextWindow: "128000", maxTokens: "8192" },
          { id: "deepseek-reasoner", contextWindow: "128000", maxTokens: "65536" },
        ],
        defaultModel: "deepseek-chat",
        enabled: true,
      },
    ];

    renderModal({
      providers: providersWithModelParams,
      onSaveProvider,
    });

    // 1. 在通用设置区域，展示已下沉提示，不展示全局重复输入
    expect(screen.getByText("模型参数已与各模型绑定")).toBeInTheDocument();

    // 2. 点击编辑 DeepSeek
    const editBtn = screen.getByRole("button", { name: "编辑" });
    fireEvent.click(editBtn);

    // 展开自定义设置
    fireEvent.click(screen.getByText(/自定义设置/));

    // 3. 验证模型徽章展示（两个模型均配置了 128k 上下文）
    expect(screen.getAllByText("128k 窗口")).toHaveLength(2);
    expect(screen.getByText("8k 输出")).toBeInTheDocument();
    expect(screen.getByText("64k 输出")).toBeInTheDocument();

    // 4. 点击配置第一个模型 deepseek-chat
    const configBtn = screen.getByRole("button", { name: "配置模型 deepseek-chat" });
    fireEvent.click(configBtn);

    expect(screen.getByText("配置模型参数")).toBeInTheDocument();
    const ctxInput = screen.getByLabelText(/上下文窗口/);
    const maxTokensInput = screen.getByLabelText(/最大输出 Tokens/);

    expect(ctxInput).toHaveValue(128000);
    expect(maxTokensInput).toHaveValue(8192);

    // 修改为 256000 与 16384
    fireEvent.change(ctxInput, { target: { value: "256000" } });
    fireEvent.change(maxTokensInput, { target: { value: "16384" } });

    fireEvent.click(screen.getByRole("button", { name: "保存参数" }));

    // 5. 点击保存 Provider 并断言参数已更新
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSaveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "deepseek",
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "deepseek-chat",
            contextWindow: "256000",
            maxTokens: "16384",
          }),
        ]),
      })
    );
  });
});

