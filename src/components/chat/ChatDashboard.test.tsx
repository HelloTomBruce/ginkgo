import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import ChatDashboard from "../ChatDashboard";
import { DEFAULT_WELCOME_MESSAGE } from "@/lib/sessionStorage";
import {
  installSessionServer,
  makeSessionRecord,
} from "@/test/mockSessionApi";

// useChat mock 构造器：vi.mock 工厂被提升到文件顶部，只能引用 vi.hoisted 产物与导入值（惰性求值）
const buildUseChatResult = vi.hoisted(
  () =>
    // UIMessage 结构子集即可（测试消息仅含 role/content）
    (
      messages: Array<{ role: string; content: string }>,
      data: unknown[] = []
    ) =>
      ({
        messages,
        setMessages: vi.fn(),
        input: "",
        setInput: vi.fn(),
        handleInputChange: vi.fn(),
        handleSubmit: vi.fn((e?: { preventDefault?: () => void }) =>
          e?.preventDefault?.()
        ),
        status: "ready" as const,
        append: vi.fn(),
        isLoading: false,
        error: undefined,
        reload: vi.fn(),
        stop: vi.fn(),
        setData: vi.fn(),
        id: "mock-chat",
        addToolResult: vi.fn(),
        data: data as never,
      })
);
const defaultUseChatResult = () => buildUseChatResult([DEFAULT_WELCOME_MESSAGE]);

// mock useChat：默认返回欢迎消息，避免真实网络流
vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(() => buildUseChatResult([DEFAULT_WELCOME_MESSAGE])),
}));

// mock OpenUIRenderer：守护测试关注外壳结构，不加载 openui 渲染生态
vi.mock("@/components/OpenUIRenderer", () => ({
  OpenUIRenderer: ({ content }: { content: string }) => (
    <div data-testid="openui-renderer">{content}</div>
  ),
}));

describe("ChatDashboard 守护测试（重构行为锁定）", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let server: ReturnType<typeof installSessionServer>;

  beforeEach(() => {
    localStorage.clear();
    server = installSessionServer();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.mocked(useChat).mockImplementation(defaultUseChatResult as never);
  });

  it("渲染欢迎消息文本", async () => {
    render(<ChatDashboard />);
    // 会话 bootstrap 完成后 MessageList 才挂载（异步）
    expect(
      await screen.findByText(/对话式数据分析助手/, { exact: false })
    ).toBeInTheDocument();
  });

  it("渲染侧边栏新建会话按钮与设置入口", () => {
    render(<ChatDashboard />);
    expect(screen.getByText("新建会话")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "设置" })
    ).toBeInTheDocument();
  });

  it("useChat body 透传当前会话 enabledSources", async () => {
    const session = makeSessionRecord({
      title: "带数据源会话",
      enabledSources: ["postgres"],
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    server.seed([session], session.id);

    render(<ChatDashboard />);

    // bootstrap 完成后 activeSession 就绪，useChat 随重渲染收到新 body
    await waitFor(() => {
      const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
        body?: { sources?: string[] };
      };
      expect(config?.body?.sources).toEqual(["postgres"]);
    });
    const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
      body?: { sources?: string[] };
    };
    expect(config?.body).not.toHaveProperty("gitlabUrl");
    expect(config?.body).not.toHaveProperty("gitlabToken");
  });

  it("会话开始后（已有用户消息）数据源选择器锁定为只读", async () => {
    // 会话已有对话内容（服务端种子的历史消息）：锁定数据源选择。
    // 有状态 mock：setMessages 真正更新 messages，新建会话后可验证解锁
    const state: { messages: unknown[] } = {
      messages: [DEFAULT_WELCOME_MESSAGE],
    };
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...defaultUseChatResult(),
          setMessages: vi.fn((m: unknown[]) => {
            state.messages = m;
          }),
          get messages() {
            return state.messages;
          },
        }) as never
    );
    // 数据源列表可用，验证勾选框被禁用而非列表为空
    // （会话 API 走内存服务端，数据源列表走 fallback）
    server = installSessionServer(
      () =>
        new Response(
          JSON.stringify({
            sources: [
              { id: "postgres", name: "PostgreSQL 分析库", enabled: true },
              { id: "jira", name: "Jira MCP", enabled: true },
            ],
            health: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const seeded = makeSessionRecord({
      title: "已有对话的会话",
      messages: [
        DEFAULT_WELCOME_MESSAGE,
        { id: "u1", role: "user", content: "分析销售额" },
      ],
    });
    server.seed([seeded], seeded.id);
    render(<ChatDashboard />);
    fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

    // bootstrap 把服务端历史消息同步进消息流后，选择器锁定
    const cb = await screen.findByLabelText("Jira MCP");
    await waitFor(() => expect(cb).toBeDisabled());
    expect(screen.getByText(/已锁定/)).toBeInTheDocument();
    // 新建会话（仅欢迎消息）应解锁
    fireEvent.click(screen.getByText("新建会话"));
    await waitFor(async () => {
      const cbFresh = await screen.findByLabelText("Jira MCP");
      expect(cbFresh).not.toBeDisabled();
    });
  });

  it("上下文用量条：初始状态常驻展示 0.0k 用量与当前模型窗口容量", async () => {
    render(<ChatDashboard />);
    await screen.findByText(/0\.0k \/ 128k（0%）/);
    expect(screen.getByText("上下文")).toBeInTheDocument();
  });

  it("上下文用量条：onFinish 实测 promptTokens 渲染百分比", async () => {
    render(<ChatDashboard />);
    await screen.findByText(/对话式数据分析助手/, { exact: false });

    // 拿到 useChat 的 onFinish 回调，模拟一次带 usage 的流式结束
    const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
      onFinish?: (
        message: unknown,
        options?: { usage?: { promptTokens: number } }
      ) => void;
    };
    config.onFinish?.(
      { id: "a1", role: "assistant", content: "done" },
      { usage: { promptTokens: 64_000 } }
    );

    // 默认模型 gpt-4o-mini → 窗口 128k；64000/128000 = 50%
    await screen.findByText(/64\.0k \/ 128k（50%）/);
    expect(screen.getByText("上下文")).toBeInTheDocument();
  });

  // TODO(user)：用量条展示 UI 已在重构中移除（deriveContextUsage 派生仍在），
  // 恢复展示后取消本 skip 并断言新 UI 文案
  it("上下文用量条：优先消费 StreamData 中的 context_usage（真实单步峰值）", async () => {
    vi.mocked(useChat).mockImplementation(
      () =>
        buildUseChatResult(
          [DEFAULT_WELCOME_MESSAGE],
          [{ type: "context_usage", promptTokens: 32_000 }]
        ) as never
    );
    render(<ChatDashboard />);
    await screen.findByText(/32\.0k \/ 128k（25%）/);
    expect(screen.getByText("上下文")).toBeInTheDocument();
  });

  it("上下文用量条：当用户配置了自定义 contextWindow（如 1024000）时，依自定义容量渲染分母", async () => {
    localStorage.setItem("openui_llm_context_window", "1024000");
    vi.mocked(useChat).mockImplementation(
      () =>
        buildUseChatResult(
          [DEFAULT_WELCOME_MESSAGE],
          [{ type: "context_usage", promptTokens: 64_000 }]
        ) as never
    );
    render(<ChatDashboard />);
    // 64000 / 1024000 = 6%
    await screen.findByText(/64\.0k \/ 1024k（6%）/);
    expect(screen.getByText("上下文")).toBeInTheDocument();
  });

  it("会话生成中：输入区域展示停止按钮，点击触发 stop 并提示", async () => {
    const stopMock = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...defaultUseChatResult(),
          isLoading: true,
          stop: stopMock,
        }) as never
    );

    render(<ChatDashboard />);
    const stopBtn = screen.getByRole("button", { name: /停止生成/ });
    expect(stopBtn).toBeInTheDocument();
    fireEvent.click(stopBtn);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("流式中切换会话：先停流并把进度落盘到原会话；迟到的 onFinish 不写入任何会话", async () => {
    const sessionA = makeSessionRecord({
      title: "会话甲",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    const sessionB = makeSessionRecord({
      title: "会话乙",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    server.seed([sessionA, sessionB], sessionA.id);

    const stopMock = vi.fn();
    const streamingMsgs = [
      DEFAULT_WELCOME_MESSAGE,
      { role: "user", content: "甲的问题" },
      { role: "assistant", content: "甲的部分回答" },
    ];
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...defaultUseChatResult(),
          messages: streamingMsgs,
          isLoading: true,
          stop: stopMock,
        }) as never
    );

    render(<ChatDashboard />);
    // 侧边栏就绪后流式中切换到会话乙
    fireEvent.click(await screen.findByText("会话乙"));

    // 切换前先停流，且把流式进度落盘到原会话甲
    expect(stopMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const saved = server.records.get(sessionA.id)?.messages as Array<{
        content?: string;
      }>;
      expect(saved?.some((m) => m.content === "甲的部分回答")).toBe(true);
    });

    // 迟到的 onFinish（属于已被停掉的旧流）不得写入任何会话
    const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
      onFinish?: (m: unknown, o?: unknown) => void;
    };
    config?.onFinish?.({ role: "assistant", content: "迟到的旧流回答" }, undefined);
    const allSaved = [
      ...server.records.values(),
    ].flatMap((r) => r.messages as Array<{ content?: string }>);
    expect(allSaved.some((m) => m.content === "迟到的旧流回答")).toBe(false);
  });

  it("首次渲染无 React 错误 / hydration 告警", () => {
    render(<ChatDashboard />);
    const reactErrors = consoleErrorSpy.mock.calls.filter((args: unknown[]) =>
      args.some(
        (a: unknown) =>
          typeof a === "string" &&
          (a.includes("Hydrat") ||
            a.includes("hydrat") ||
            a.includes("did not match") ||
            a.includes("Error:"))
      )
    );
    expect(reactErrors).toEqual([]);
  });

  it("Plan-first 开关：默认开提交带 mode=plan；关闭后不带 mode", async () => {
    const handleSubmit = vi.fn((e?: { preventDefault?: () => void }) =>
      e?.preventDefault?.()
    );
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...defaultUseChatResult(),
          handleSubmit,
        }) as never
    );

    render(<ChatDashboard />);
    // 默认开：输入框 placeholder 为「先出思路模式」提示
    const form = (
      await screen.findByPlaceholderText(/先出思路模式/)
    ).closest("form") as HTMLFormElement;

    // 默认开：plan
    fireEvent.submit(form);
    expect(handleSubmit).toHaveBeenLastCalledWith(expect.anything(), {
      body: { mode: "plan" },
    });

    // 关闭「先出思路」（输入框内无边框开关按钮，aria-pressed 标识态）
    const planToggle = screen.getByRole("button", { name: /先出思路/ });
    expect(planToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(planToggle);
    expect(planToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.submit(form);
    expect(handleSubmit).toHaveBeenLastCalledWith(expect.anything(), {
      body: {},
    });
  });

  it("规划待确认（最后 assistant 含 PlanReviewCard）：答复按 execute 发送；预设场景始终直出", async () => {
    const handleSubmit = vi.fn((e?: { preventDefault?: () => void }) =>
      e?.preventDefault?.()
    );
    const append = vi.fn();
    const setInput = vi.fn();
    const messages = [
      DEFAULT_WELCOME_MESSAGE,
      { id: "u1", role: "user" as const, content: "分析各渠道 CAC" },
      {
        id: "a1",
        role: "assistant" as const,
        content:
          '思路如下：\n```openui\nroot = Root([plan])\nplan = PlanReviewCard("CAC 分析思路确认", "各渠道对比", [], [{"title":"取数"}], [])\n```',
      },
    ];
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...buildUseChatResult(messages),
          handleSubmit,
          append,
          setInput,
        }) as never
    );

    render(<ChatDashboard />);

    // 打字答复规划（提交）→ execute
    const form = (
      await screen.findByRole("button", { name: /发送/ })
    ).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(handleSubmit).toHaveBeenLastCalledWith(expect.anything(), {
      body: { mode: "execute" },
    });

    // 预设场景：只填入输入框不直接发送（提交时与手输一致走常规判定）
    // （侧栏三 tab 改版后文案为「历史 / 看板 / 推荐」；推荐项由方法卡 presetQuery 生成）
    fireEvent.click(screen.getByText("推荐"));
    fireEvent.click(
      screen.getByText(/核心指标近半年逐月走势如何/, { exact: false })
    );
    // 点击推荐：setInput 填入文本，不调用 append
    expect(setInput).toHaveBeenCalledWith(
      expect.stringContaining("核心指标近半年逐月走势如何")
    );
    expect(append).not.toHaveBeenCalled();
  });

  it("纯文本规划回复（模型漏出 PlanReviewCard 代码块）：提交答复仍按 execute 发送，防止死循环", async () => {
    const handleSubmit = vi.fn((e?: { preventDefault?: () => void }) =>
      e?.preventDefault?.()
    );
    const messages = [
      DEFAULT_WELCOME_MESSAGE,
      { id: "u1", role: "user" as const, content: "gitlab 活跃项目" },
      {
        id: "a1",
        role: "assistant" as const,
        content:
          "## 🔍 分析思路\n1. 排名分层\n\n## ❓ 澄清点说明\n| 问题 | 假设 |\n\n请确认以下分析方案（点击卡片中的选项后一键确认）：",
      },
    ];
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...buildUseChatResult(messages),
          handleSubmit,
        }) as never
    );

    render(<ChatDashboard />);

    const form = (
      await screen.findByRole("button", { name: /发送/ })
    ).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(handleSubmit).toHaveBeenLastCalledWith(expect.anything(), {
      body: { mode: "execute" },
    });
  });
});
