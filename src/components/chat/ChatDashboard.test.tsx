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

  it("流式中切换会话：客户端脱钩落盘但不杀服务端任务（回切可续接）；迟到的 onFinish 不写入任何会话", async () => {
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
    // 先模拟一次发起（建立流式会话标记——否则 stopActiveStream 拿不到
    // activeId，旧代码的 server-stop 分支走不到，断言会空转），再切到会话乙。
    // 须等 bootstrap 完成（侧栏就绪）再提交，否则 currentSessionId 仍为 null
    await screen.findByText("会话乙");
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.click(screen.getByText("会话乙"));

    // 切换前客户端脱钩（停止订阅），且把流式进度落盘到原会话甲
    expect(stopMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const saved = server.records.get(sessionA.id)?.messages as Array<{
        content?: string;
      }>;
      expect(saved?.some((m) => m.content === "甲的部分回答")).toBe(true);
    });

    // 关键回归：脱钩不得向服务端发送 action:stop——StreamHub 任务后台续跑，
    // 回切时 probe 重连续接（修复前此处杀任务导致「切走再切回输出中断」）
    const serverStops = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      if (String(url) !== "/api/analyze") return false;
      try {
        return (
          JSON.parse(String(init?.body ?? "{}")).action === "stop"
        );
      } catch {
        return false;
      }
    });
    expect(serverStops).toHaveLength(0);

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

  it("用户显式停止：客户端脱钩并通知服务端终止后台任务", async () => {
    const session = makeSessionRecord({
      title: "当前会话",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    server.seed([session], session.id);

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
    // 模拟一次发起（建立流式会话标记），随后点击停止
    // （isLoading 时发送按钮被停止按钮替换，表单本身仍在，直接从 DOM 取）
    await screen.findByRole("button", { name: /停止生成/ });
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: /停止生成/ }));

    expect(stopMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const serverStops = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
        if (String(url) !== "/api/analyze") return false;
        try {
          return (
            JSON.parse(String(init?.body ?? "{}")).action === "stop" &&
            JSON.parse(String(init?.body ?? "{}")).sessionId === session.id
          );
        } catch {
          return false;
        }
      });
      expect(serverStops).toHaveLength(1);
    });
  });

  it("重连探测：hasTask（脱钩期间后台跑完）也触发重放收尾", async () => {
    const session = makeSessionRecord({
      title: "会话甲",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    server = installSessionServer((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("/api/analyze") && method === "GET") {
        return new Response(
          JSON.stringify({ running: false, hasTask: true }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
    server.seed([session], session.id);

    const reload = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () => ({ ...defaultUseChatResult(), reload }) as never
    );

    render(<ChatDashboard />);

    // running=false 但 hasTask=true：终态保留窗内重连重放，尾巴内容落盘不丢
    await waitFor(() => {
      expect(reload).toHaveBeenCalledWith({
        body: { mode: "plan", reconnect: true },
      });
    });
  });

  it("上下文锚点准确性：onFinish 持久化消息时不得写入累计 usage 到 context（锚点仅服务端实测写入）", async () => {
    const session = makeSessionRecord({
      title: "锚点会话",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    server.seed([session], session.id);

    render(<ChatDashboard />);
    const form = (
      await screen.findByRole("button", { name: /发送/ })
    ).closest("form") as HTMLFormElement;
    // 提交建立流式会话标记（streamingSessionIdRef），模拟真实发起
    fireEvent.submit(form);

    const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
      onFinish?: (
        message: unknown,
        options?: { usage?: { promptTokens: number } }
      ) => void;
    };
    config.onFinish?.(
      { id: "a1", role: "assistant", content: "分析完成" },
      // AI SDK 多步工具调用场景下这是累计值（如 3 步 × 单步 21k），
      // 绝不能作为 token 锚点持久化
      { usage: { promptTokens: 64_000 } }
    );

    await waitFor(() => {
      const puts = vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            String(url) === `/api/sessions/${session.id}` &&
            (init?.method ?? "GET").toUpperCase() === "PUT"
        );
      expect(puts.length).toBeGreaterThan(0);
      for (const [, init] of puts) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          context?: unknown;
        };
        // 回归：修复前会把累计 usage 写进 context.lastPromptTokens，
        // 覆盖服务端 handler 按最后一步单步实测写入的准确锚点
        expect(body).not.toHaveProperty("context");
      }
    });
  });

  it("切换会话时清空 StreamData（context_usage 不跨会话串显）", async () => {
    const sessionA = makeSessionRecord({
      title: "会话甲",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    const sessionB = makeSessionRecord({
      title: "会话乙",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    server.seed([sessionA, sessionB], sessionA.id);

    const setData = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...buildUseChatResult(
            [DEFAULT_WELCOME_MESSAGE],
            [{ type: "context_usage", promptTokens: 32_000 }]
          ),
          setData,
        }) as never
    );

    render(<ChatDashboard />);
    fireEvent.click(await screen.findByText("会话乙"));

    // 回归：修复前 StreamData 跨会话存续（SDK 从不清空），
    // 用量条继续显示会话甲的 token 峰值
    expect(setData).toHaveBeenCalledWith(undefined);
  });

  it("重新分析切会话后：重连探测不得对已在途提交发起 reload（防重复消费同一流）", async () => {
    const origin = makeSessionRecord({
      title: "原会话",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    const current = makeSessionRecord({
      title: "当前会话",
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    installDashboardMock(origin.id);
    server.seed([origin, current], current.id);

    const reload = vi.fn();
    const append = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () => ({ ...defaultUseChatResult(), append, reload }) as never
    );

    render(<ChatDashboard />);
    const reanalyzeBtn = await openDashboardPreview();
    fireEvent.click(reanalyzeBtn);

    // append 已在途后，重连探测（running=true 由 installDashboardMock 的
    // /api/analyze fallback 提供）必须被「提交在途」守卫拦下
    await waitFor(() => {
      expect(append).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const probes = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) =>
          String(url).startsWith("/api/analyze?sessionId=")
        );
      expect(probes.length).toBeGreaterThan(0);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("删除当前会话：清空 StreamData 且不影响其他会话（同族串显防御）", async () => {
    const sessionA = makeSessionRecord({
      title: "会话甲",
      messages: [DEFAULT_WELCOME_MESSAGE],
      createdAt: 2000,
      updatedAt: 2000,
    });
    const sessionB = makeSessionRecord({
      title: "会话乙",
      messages: [DEFAULT_WELCOME_MESSAGE],
      createdAt: 1000,
      updatedAt: 1000,
    });
    server.seed([sessionA, sessionB], sessionA.id);

    const setData = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () => ({ ...defaultUseChatResult(), setData }) as never
    );

    render(<ChatDashboard />);
    // 列表按 updatedAt 降序，首位即当前会话甲；删除它须清除其 context_usage
    const deleteBtns = await screen.findAllByRole("button", {
      name: "删除会话",
    });
    fireEvent.click(deleteBtns[0]);
    expect(setData).toHaveBeenCalledWith(undefined);
  });

  it("useChat 配置：流式渲染合批 experimental_throttle=100（防增量风暴卡死主线程）", () => {
    render(<ChatDashboard />);
    const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
      experimental_throttle?: number;
    };
    expect(config.experimental_throttle).toBe(100);
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

  it("预览弹窗重命名：保存后弹窗标题立即更新（回写预览快照，不停留旧标题）", async () => {
    // 内存看板库：rename 只刷新列表摘要，预览记录须由 handleRenameDashboard 同步回写
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const record = {
      id: "dash_ab12cd34",
      title: "旧标题看板",
      dsl: "root = Root([])",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const summary = {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    server = installSessionServer((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("/api/dashboards") && !/\/dashboards\/[^/]+/.test(url) && method === "GET") {
        return json({ dashboards: [summary] });
      }
      if (url === `/api/dashboards/${record.id}`) {
        if (method === "GET") return json({ dashboard: record });
        if (method === "PUT") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            title?: string;
          };
          if (body.title) {
            record.title = body.title;
            summary.title = body.title;
          }
          return json({ dashboard: summary });
        }
      }
      return json({ error: "not mocked" }, 404);
    });

    render(<ChatDashboard />);

    // 侧栏切到看板库 → 打开预览弹窗
    fireEvent.click(
      await screen.findByRole("button", { name: /看板 \(1\)/ })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "查看看板 旧标题看板" })
    );
    expect(
      await screen.findByRole("heading", { name: "旧标题看板" })
    ).toBeInTheDocument();

    // 行内重命名 → 保存
    fireEvent.click(screen.getByRole("button", { name: "重命名看板" }));
    fireEvent.change(screen.getByRole("textbox", { name: "看板标题" }), {
      target: { value: "新标题看板" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存标题" }));

    // 弹窗标题立即更新为新值（回归：修复前停留在旧标题直到关闭重开）
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "新标题看板" })
      ).toBeInTheDocument();
    });
  });

  /** 看板库 mock：一条摘要 + 完整记录（origin 指向指定会话） */
  function installDashboardMock(originSessionId: string | undefined) {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const record = {
      id: "dash_re1",
      title: "可重分析看板",
      dsl: "root = Root([])",
      prompt: "原始提问：各渠道 CAC 如何",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(originSessionId
        ? { origin: { sessionId: originSessionId, messageId: "m1" } }
        : {}),
    };
    const summary = { ...record, dsl: undefined };
    server = installSessionServer((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("/api/dashboards") && !/\/dashboards\/[^/]+/.test(url) && method === "GET") {
        return json({ dashboards: [summary] });
      }
      if (url === `/api/dashboards/${record.id}` && method === "GET") {
        return json({ dashboard: record });
      }
      // 重连探测端点：仅原会话模拟「服务端有在途任务」（probe 守卫的触发前提）；
      // 其他会话 running=false，避免 bootstrap 首次探测触发合法重连干扰断言
      if (url.startsWith("/api/analyze") && method === "GET") {
        return json({
          running: originSessionId ? url.includes(originSessionId) : false,
        });
      }
      return json({ error: "not mocked" }, 404);
    });
  }

  /** 打开看板库 tab 并进入预览弹窗 */
  async function openDashboardPreview() {
    fireEvent.click(
      await screen.findByRole("button", { name: /看板 \(1\)/ })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "查看看板 可重分析看板" })
    );
    return screen.findByRole("button", { name: /重新分析/ });
  }

  it("重新分析：原会话存在但不活跃时切回原会话并以其数据源发送", async () => {
    const origin = makeSessionRecord({
      title: "原会话",
      enabledSources: ["psql"],
      messages: [
        DEFAULT_WELCOME_MESSAGE,
        { id: "u1", role: "user", content: "各渠道 CAC" },
      ],
    });
    const current = makeSessionRecord({
      title: "当前会话",
      enabledSources: ["zentao"],
      messages: [DEFAULT_WELCOME_MESSAGE],
    });
    installDashboardMock(origin.id);
    server.seed([origin, current], current.id);

    const append = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () => ({ ...defaultUseChatResult(), append }) as never
    );

    render(<ChatDashboard />);
    const reanalyzeBtn = await openDashboardPreview();
    fireEvent.click(reanalyzeBtn);

    await waitFor(() => {
      expect(append).toHaveBeenCalledWith(
        { role: "user", content: "原始提问：各渠道 CAC 如何" },
        { body: { sources: ["psql"], sessionId: origin.id } }
      );
    });
  });

  it("重新分析：原会话已删除时提示无法重新分析，不发送也不新建会话", async () => {
    const current = makeSessionRecord({
      title: "当前会话",
      enabledSources: ["zentao"],
      messages: [
        DEFAULT_WELCOME_MESSAGE,
        { id: "u1", role: "user", content: "别的分析" },
      ],
    });
    installDashboardMock("sess_gone0000");
    server.seed([current], current.id);

    const append = vi.fn();
    vi.mocked(useChat).mockImplementation(
      () => ({ ...defaultUseChatResult(), append }) as never
    );

    render(<ChatDashboard />);
    const reanalyzeBtn = await openDashboardPreview();
    fireEvent.click(reanalyzeBtn);

    // 明确报错终止：toast 提示、不 append、不新建会话
    expect(
      await screen.findByText("原会话已删除，无法重新分析")
    ).toBeInTheDocument();
    expect(append).not.toHaveBeenCalled();
    const posts = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/sessions" &&
          (init?.method ?? "GET").toUpperCase() === "POST"
      );
    expect(posts).toHaveLength(0);
  });
});
