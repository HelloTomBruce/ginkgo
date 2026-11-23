import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "./SettingsModal";
import type { ConfiguredProvider } from "@/lib/llmProviders";
import type { AppSettingsSectionProps, AppSettingsSectionSpec } from "@ginkgo/app-sdk";

// mock /api/datasources 与 /api/mcp
const fetchMock = vi.fn().mockImplementation(async (url: string) => {
  if (typeof url === "string" && url.includes("/api/mcp")) {
    return {
      ok: true,
      json: async () => ({
        servers: [
          { id: "zentao-mcp", name: "ZenTao MCP", transport: "sse", enabled: true },
        ],
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      sources: [
        { id: "zentao", name: "ZenTao MCP", kind: "zentao-cli", tools: ["search_bugs"] },
      ],
      health: { zentao: { ok: true, latencyMs: 42 } },
    }),
  };
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

  it("标题为「设置」，含模型配置 / 数据源 / MCP 扩展 / 引擎调度 / 治理观测 五个 tab", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据源" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "MCP 扩展" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "引擎调度" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "治理观测" })).toBeInTheDocument();
  });

  it("点击「MCP 扩展」tab 切换面板，展示 MCP 扩展注册界面", async () => {
    renderModal();
    const tab = screen.getByRole("tab", { name: "MCP 扩展" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);

    await waitFor(() => {
      expect(screen.getByText(/MCP 工具扩展/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /注册 MCP 服务/ })).toBeInTheDocument();
  });

  it("点击「引擎调度」tab 切换面板，展示 Harness 引擎调度配置", async () => {
    renderModal();
    const tab = screen.getByRole("tab", { name: "引擎调度" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);

    await waitFor(() => {
      expect(screen.getByText(/Harness 引擎调度与韧性配置/)).toBeInTheDocument();
      expect(screen.getByText(/执行与韧性策略/)).toBeInTheDocument();
    });
  });

  it("点击「治理观测」tab 切换面板，展示 FinOps 与 OTel 治理观测配置", async () => {
    renderModal();
    const tab = screen.getByRole("tab", { name: "治理观测" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);

    await waitFor(() => {
      expect(screen.getByText(/治理观测与成本控制/)).toBeInTheDocument();
      expect(screen.getByText(/FinOps 成本控制与预算熔断/)).toBeInTheDocument();
    });
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

  it("非思考模型展示采样温度（Temperature）滑块", () => {
    renderModal({ model: "gpt-4o-mini", temperature: "0.2" });
    expect(screen.getByText("采样温度（Temperature）")).toBeInTheDocument();
    expect(screen.getByText("0.2")).toBeInTheDocument();
  });

  it("当选择思考模型（如 o3-mini/deepseek-reasoner）时，动态切换为展示推理等级（Reasoning Effort）单选卡", () => {
    const onReasoningEffortChange = vi.fn();
    renderModal({
      model: "o3-mini",
      reasoningEffort: "medium",
      onReasoningEffortChange,
    });
    expect(screen.getByText("推理等级（Reasoning Effort）")).toBeInTheDocument();
    expect(screen.getByText("深度思考模型")).toBeInTheDocument();
    expect(screen.queryByText("采样温度（Temperature）")).not.toBeInTheDocument();

    const highRadio = screen.getByRole("radio", { name: /High/ });
    fireEvent.click(highRadio);
    expect(onReasoningEffortChange).toHaveBeenCalledWith("high");
  });

  it("最大步数上限与备选降级模型在「引擎调度」Tab 中配置并触发回调", async () => {
    const onMaxStepsChange = vi.fn();
    const onFallbackModelsChange = vi.fn();
    renderModal({
      maxSteps: "35",
      fallbackModels: "qwen-plus, deepseek-chat",
      onMaxStepsChange,
      onFallbackModelsChange,
    });

    const engineTab = screen.getByRole("tab", { name: "引擎调度" });
    fireEvent.mouseDown(engineTab, { button: 0 });
    fireEvent.click(engineTab);

    await waitFor(() => {
      expect(screen.getByLabelText(/最大思考步数上限/)).toBeInTheDocument();
    });

    expect(screen.getByText("35 步")).toBeInTheDocument();
    const stepsInput = screen.getByLabelText(/最大思考步数上限/);
    fireEvent.change(stepsInput, { target: { value: "45" } });
    expect(onMaxStepsChange).toHaveBeenCalledWith("45");

    const fallbackInput = screen.getByLabelText(/备选降级模型/);
    expect(fallbackInput).toHaveValue("qwen-plus, deepseek-chat");
    fireEvent.change(fallbackInput, { target: { value: "gpt-4o-mini" } });
    expect(onFallbackModelsChange).toHaveBeenCalledWith("gpt-4o-mini");
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

    // 1. 在设置区域，展示已下沉提示，不展示全局重复输入
    expect(
      screen.getByText(/上下文容量与最大输出可在上方「模型目录」/)
    ).toBeInTheDocument();

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

    // 修改为 256000 与 16384 并勾选支持深度思考 / 推理
    fireEvent.change(ctxInput, { target: { value: "256000" } });
    fireEvent.change(maxTokensInput, { target: { value: "16384" } });

    const reasoningCheckbox = screen.getByLabelText(/支持深度思考 \/ 推理/);
    expect(reasoningCheckbox).toBeInTheDocument();
    expect(reasoningCheckbox).not.toBeChecked();
    fireEvent.click(reasoningCheckbox);
    expect(reasoningCheckbox).toBeChecked();

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
            supportsReasoning: true,
          }),
        ]),
      })
    );
  });
});

describe("SettingsModal 应用分区（client.settingsSections 插槽）", () => {
  /** 最小分区组件：展示注入的 appId，经注入的 request 发一次 PUT */
  function FakeSection({ appId, request }: AppSettingsSectionProps) {
    const [status, setStatus] = useState("");
    return (
      <div>
        <span>分区:{appId}</span>
        <button
          onClick={() =>
            void request("/api/cross-source", { method: "PUT", body: "{}" }).then(
              (r) => setStatus(String(r.status))
            )
          }
        >
          发请求
        </button>
        {status && <span>状态:{status}</span>}
      </div>
    );
  }

  const SECTIONS: AppSettingsSectionSpec[] = [
    { key: "cross-source", label: "跨源映射", icon: "Link2", Component: FakeSection },
  ];

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("未声明 appSections 时仅渲染平台 tab，无应用分区", () => {
    vi.stubGlobal("fetch", fetchMock);
    renderModal();
    expect(screen.getByRole("tab", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "跨源映射" })).toBeNull();
  });

  it("声明后追加应用分区 tab（图标按名解析），切换后渲染分区组件并注入 appId", () => {
    vi.stubGlobal("fetch", fetchMock);
    renderModal({ appId: "analytics", appSections: SECTIONS });

    const tab = screen.getByRole("tab", { name: "跨源映射" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);

    expect(screen.getByText("分区:analytics")).toBeInTheDocument();
  });

  it("分区经宿主注入的 request 发请求：未配置令牌时不带鉴权头", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchSpy);
    renderModal({ appId: "analytics", appSections: SECTIONS });

    const tab = screen.getByRole("tab", { name: "跨源映射" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);
    fireEvent.click(screen.getByRole("button", { name: "发请求" }));

    await waitFor(() => expect(screen.getByText("状态:200")).toBeInTheDocument());
    const [, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  });

  it("配置部署鉴权令牌后，分区请求自动附带 Authorization 头", async () => {
    localStorage.setItem("ginkgo_access_token", "tok-123");
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchSpy);
    renderModal({ appId: "analytics", appSections: SECTIONS });

    const tab = screen.getByRole("tab", { name: "跨源映射" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);
    fireEvent.click(screen.getByRole("button", { name: "发请求" }));

    await waitFor(() => expect(screen.getByText("状态:200")).toBeInTheDocument());
    const [, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-123");
  });
});

