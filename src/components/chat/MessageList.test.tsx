import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Message } from "@ai-sdk/react";
import { extractUiSpec } from "@/lib/extractUiSpec";
import { toast } from "@/lib/toast";
import { MessageList } from "./MessageList";

/** analytics 应用声明样例（与 manifest.ts 的 messageExtensions 同构） */
const ANALYTICS_EXTENSIONS = {
  completion: {
    title: "数据取数与分析计算已全部完成",
    buttonLabel: "立即生成报告与看板",
    actionPrompt:
      "数据取数与计算已全部完成。请立即基于上述结果，输出完整的 Markdown 深度分析报告以及 ```ginkgo 可视化动态看板代码块。",
  },
  toolSettledHint: "数据查询已完成，大模型正在组织分析洞察并构建视觉看板...",
};
import type { FavoriteResult } from "@/hooks/useDashboards";

vi.mock("@/lib/extractUiSpec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extractUiSpec")>();
  return { ...actual, extractUiSpec: vi.fn(actual.extractUiSpec) };
});

vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

vi.mock("@/components/UiSpecRenderer", () => ({
  UiSpecRenderer: () => <div data-testid="renderer" />,
}));

const userMsg: Message = { id: "u1", role: "user", content: "分析营收" };
const aiMsg: Message = { id: "a1", role: "assistant", content: "结论如下" };

// AI SDK 运行时会在 data stream v1 上附加 toolInvocations（组件按可选字段读取）
function withTools(tools: Array<{ toolName: string; args?: Record<string, unknown> }>): Message[] {
  return [
    userMsg,
    {
      ...aiMsg,
      toolInvocations: tools.map((t, i) => ({
        toolCallId: `call-${i}`,
        toolName: t.toolName,
        args: t.args ?? {},
        state: "result",
        result: {},
      })),
    } as unknown as Message,
  ];
}

describe("MessageList 流式重渲染治理", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("动态源前缀工具归因到源名称，未匹配走通用兜底（不误标 MCP）", () => {
    render(
      <MessageList
        messages={withTools([
          { toolName: "zhaobiao_list_tables" },
          { toolName: "execute_sql", args: { sql: "SELECT 1" } },
          { toolName: "zhaobiao_execute_sql", args: { sql: "SELECT 2" } },
          { toolName: "__tool_call_feedback__" },
        ])}
        status="ready"
        error={undefined}
        activeSources={[
          { id: "zhaobiao", name: "招标平台数据/" },
        ]}
        onRendererAction={vi.fn()}
        onReload={vi.fn()}
      />
    );

    expect(screen.getByText(/\[招标平台数据\/\] 调用: zhaobiao_list_tables/)).toBeInTheDocument();
    // 无前缀匹配走通用兜底（非 MCP 专属）；同契约动态源按前缀归因
    expect(screen.getByText(/工具调用: execute_sql/)).toBeInTheDocument();
    expect(screen.getByText(/\[招标平台数据\/\] 执行 SQL: SELECT 2/)).toBeInTheDocument();
    // 内部纠错兜底工具弱化展示为「参数纠错」
    expect(screen.getByText(/⚡ 参数纠错/)).toBeInTheDocument();
  });

  it("加载提示反映会话启用源，未提供时回落通用文案", () => {
    const base = {
      messages: [userMsg],
      status: "submitted" as const,
      error: undefined,
      onRendererAction: vi.fn(),
      onReload: vi.fn(),
    };

    const { rerender } = render(
      <MessageList {...base} activeSources={[{ id: "zhaobiao", name: "招标平台数据/" }]} />
    );
    expect(screen.getByText(/正在分析意图并连接.*招标平台数据\//)).toBeInTheDocument();

    rerender(<MessageList {...base} activeSources={undefined} />);
    expect(screen.getByText(/正在分析意图并连接/)).toBeInTheDocument();
  });

  it("流式状态变化时，历史消息不重复执行内容提取（memo 生效）", () => {
    const props = {
      messages: [userMsg, aiMsg],
      status: "ready",
      error: undefined,
      onRendererAction: vi.fn(),
      onReload: vi.fn(),
    };

    const { rerender } = render(<MessageList {...props} />);
    expect(vi.mocked(extractUiSpec)).toHaveBeenCalledTimes(2);

    // 流式开始：仅最后一条消息的 isStreaming 变化
    rerender(<MessageList {...props} status="streaming" />);
    // user 消息 props 未变（memo 拦截）；ai 消息重渲染但 content 未变（useMemo 拦截）
    expect(vi.mocked(extractUiSpec)).toHaveBeenCalledTimes(2);
  });

  it("新消息到达时只为新消息执行提取", () => {
    const base = {
      messages: [userMsg, aiMsg],
      status: "ready",
      error: undefined,
      onRendererAction: vi.fn(),
      onReload: vi.fn(),
    };
    const { rerender } = render(<MessageList {...base} />);
    expect(vi.mocked(extractUiSpec)).toHaveBeenCalledTimes(2);

    const newMsg: Message = { id: "u2", role: "user", content: "再问一个" };
    rerender(<MessageList {...base} messages={[userMsg, aiMsg, newMsg]} />);
    expect(vi.mocked(extractUiSpec)).toHaveBeenCalledTimes(3);
  });
});

describe("MessageList 快捷滚动操作", () => {
  const base = {
    messages: [userMsg, aiMsg],
    status: "ready" as const,
    error: undefined,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** mock 滚动容器布局属性（jsdom 不做布局，默认全 0） */
  function mockScrollMetrics(
    el: HTMLElement,
    metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
  ) {
    Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: metrics.scrollTop, configurable: true });
  }

  function getScrollContainer(container: HTMLElement): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>("[data-scroll-container]");
    if (!el) throw new Error("滚动容器未找到");
    return el;
  }

  it("短列表无溢出时不显示任何快捷滚动按钮", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    fireEvent.scroll(el); // 默认全 0：视为在底部

    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();
  });

  it("位于顶部时仅显示回到底部，点击平滑滚动到底", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    el.scrollTo = vi.fn();
    mockScrollMetrics(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 });
    fireEvent.scroll(el);

    const btn = screen.getByRole("button", { name: "回到底部" });
    expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });
  });

  it("位于中部时顶/底两个按钮都显示", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    mockScrollMetrics(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 800 });
    fireEvent.scroll(el);

    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到顶部" })).toBeInTheDocument();
  });

  it("位于底部时仅显示回到顶部，点击回到顶部", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    el.scrollTo = vi.fn();
    mockScrollMetrics(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 });
    fireEvent.scroll(el);

    const btn = screen.getByRole("button", { name: "回到顶部" });
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("会话初次加载或切换时自动调用 scrollTo 滚到底部", async () => {
    const scrollToSpy = vi.fn();
    const originalScrollTo = HTMLDivElement.prototype.scrollTo;
    HTMLDivElement.prototype.scrollTo = scrollToSpy;
    try {
      render(<MessageList {...base} sessionId="sess-1" />);
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalled();
      });
    } finally {
      HTMLDivElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it("多轮提问时渲染 DSH 风格消息快捷跳转按钮，点击展开提问目录并支持一键跳转", async () => {
    const scrollIntoViewSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const multiMessages: Message[] = [
      { id: "u1", role: "user", content: "第一问：各渠道销售额" },
      { id: "a1", role: "assistant", content: "这是回答一" },
      { id: "u2", role: "user", content: "第二问：退款率对比分析" },
      { id: "a2", role: "assistant", content: "这是回答二" },
    ];

    render(<MessageList {...base} messages={multiMessages} />);

    // 快捷跳转按钮存在
    const navBtn = screen.getByRole("button", { name: "消息快捷跳转" });
    expect(navBtn).toBeInTheDocument();

    // 点击展开浮窗
    fireEvent.click(navBtn);
    expect(screen.getAllByText("第一问：各渠道销售额")).toHaveLength(2);
    expect(screen.getAllByText("第二问：退款率对比分析")).toHaveLength(2);

    // 点击浮窗中的提问项触发跳转
    fireEvent.click(screen.getAllByText("第一问：各渠道销售额")[1]);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    // 跳转后菜单自动收起
    await waitFor(() => {
      expect(screen.queryByText("关闭跳转菜单")).not.toBeInTheDocument();
    });
  });
});

describe("看板打印导出", () => {
  const dashboardMsg: Message = {
    id: "d1",
    role: "assistant",
    content: '结论如下\n```ginkgo\n{"type":"Stack","children":[]}\n```',
  };

  const baseProps = {
    status: "ready" as const,
    error: undefined,
    activeSources: undefined,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
    // 能力注入：本组用例模拟声明了导出能力的应用（如 analytics）
    dashboardExportEnabled: true,
  };

  let printSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    printSpy = vi.fn<() => void>();
    window.print = printSpy;
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("print-mode");
    vi.clearAllMocks();
  });

  it("就绪看板显示导出按钮；点击后进入打印模式并调用 window.print", async () => {
    const { container } = render(
      <MessageList {...baseProps} messages={[userMsg, dashboardMsg]} />
    );

    const btn = screen.getByRole("button", { name: /导出 PDF/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    // 目标消息标记 + body 打印模式
    expect(document.body.classList.contains("print-mode")).toBe(true);
    const target = container.querySelector(".print-target");
    expect(target).not.toBeNull();
    expect(target?.className).toContain("print-message");

    // rAF 后触发浏览器打印
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it("afterprint 后清理标记还原页面", async () => {
    const { container } = render(
      <MessageList {...baseProps} messages={[dashboardMsg]} />
    );
    fireEvent.click(screen.getByRole("button", { name: /导出 PDF/ }));
    expect(document.body.classList.contains("print-mode")).toBe(true);

    fireEvent(window, new Event("afterprint"));

    await waitFor(() => {
      expect(document.body.classList.contains("print-mode")).toBe(false);
      expect(container.querySelector(".print-target")).toBeNull();
    });
  });

  it("流式中的看板导出按钮禁用", () => {
    render(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, dashboardMsg]}
      />
    );
    expect(screen.getByRole("button", { name: /导出 PDF/ })).toBeDisabled();
  });

  it("无看板的消息不显示导出按钮", () => {
    render(<MessageList {...baseProps} messages={[userMsg, aiMsg]} />);
    expect(
      screen.queryByRole("button", { name: /导出 PDF/ })
    ).not.toBeInTheDocument();
  });

  it("能力注入：未声明导出能力的应用不渲染导出按钮", () => {
    render(
      <MessageList
        {...baseProps}
        dashboardExportEnabled={false}
        messages={[userMsg, dashboardMsg]}
      />
    );
    // 看板本体与工具条仍渲染，仅操作按钮按能力声明隐藏
    expect(
      screen.queryByRole("button", { name: /导出 PDF/ })
    ).not.toBeInTheDocument();
  });

  it("能力注入：工具条标题由应用声明注入", () => {
    render(
      <MessageList
        {...baseProps}
        dashboardTitle="自定义看板标题"
        messages={[userMsg, dashboardMsg]}
      />
    );
    expect(screen.getByText("自定义看板标题")).toBeInTheDocument();
    expect(screen.queryByText("UiSpec 动态看板")).not.toBeInTheDocument();
  });

  it("执行步骤与分析文字标记 no-print，仅看板本体导出", () => {
    const msgWithTools = {
      ...dashboardMsg,
      toolInvocations: [
        {
          toolCallId: "call-1",
          toolName: "pg_execute_sql",
          args: { sql: "SELECT 1" },
          state: "result",
          result: {},
        },
      ],
    } as unknown as Message;
    render(<MessageList {...baseProps} messages={[msgWithTools]} />);

    // 执行步骤（工具调用指示器）与分析文字均排除在打印范围外
    const toolBadge = screen
      .getByText(/工具调用: pg_execute_sql/)
      .closest(".no-print");
    expect(toolBadge).not.toBeNull();
    const thinking = screen.getByText("结论如下").closest(".no-print");
    expect(thinking).not.toBeNull();
    // 看板本体（渲染器）不在 no-print 容器内
    expect(screen.getByTestId("renderer").closest(".no-print")).toBeNull();
  });
});

describe("看板收藏", () => {
  const boardMsg: Message = {
    id: "b1",
    role: "assistant",
    content: "分析结论\n```ginkgo\nroot = Root([table])\n```",
  };

  const baseProps = {
    status: "ready" as const,
    error: undefined,
    activeSources: undefined,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("就绪看板显示收藏按钮；点击组装完整载荷（dsl/前文 prompt/origin.messageId）并成功 toast", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(
      () => Promise.resolve({ ok: true })
    );
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    const btn = screen.getByRole("button", { name: /收藏看板（消息 b1）/ });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(onFavorite).toHaveBeenCalledWith({
      dsl: "root = Root([table])",
      prompt: "分析营收",
      sourceNames: undefined,
      origin: { messageId: "b1" },
    });
    expect(toast).toHaveBeenCalledWith("已收藏到看板库", "success");
  });

  it("活看板捕获（P2-A）：execute 轮工具调用 + 直取数组件 → 载荷携带 queries/bindings", async () => {
    // execute 轮记录挂在看板消息自身（AI SDK data stream 附加）
    const liveMsg = {
      ...boardMsg,
      content:
        "分析结论\n```ginkgo\nroot = Root([chart, table])\nchart = AnalyticsChart(\"bar\", \"t\", \"s\", \"channel\", [{\"channel\":\"TikTok Ads\",\"deals\":186},{\"channel\":\"Google Ads\",\"deals\":152}], [])\ntable = DataTable(\"明细\", [], [{\"channel\":\"TikTok Ads\",\"deals\":186},{\"channel\":\"Google Ads\",\"deals\":152}])\n```",
      toolInvocations: [
        {
          toolCallId: "call-1",
          toolName: "pg1_execute_sql",
          args: { sql: "SELECT channel, deals FROM deals" },
          state: "result",
          result: {
            rows: [
              { channel: "TikTok Ads", deals: 186 },
              { channel: "Google Ads", deals: 152 },
            ],
          },
        },
      ],
    } as unknown as Message;
    const onFavorite = vi.fn<
      (input: import("@/hooks/useDashboards").FavoriteDashboardInput) => Promise<FavoriteResult>
    >(() => Promise.resolve({ ok: true }));
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, liveMsg]}
        activeSources={[{ id: "pg1", name: "营销库" }]}
        onFavoriteDashboard={onFavorite}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /收藏看板（消息 b1）/ }));
    });

    expect(onFavorite).toHaveBeenCalledTimes(1);
    const payload = onFavorite.mock.calls[0][0];
    expect(payload.dsl).toContain("root = Root([chart, table])");
    expect(payload.sourceNames).toEqual(["营销库"]);
    // 直取数组件绑定；q_ 前缀 id 与 sql payload 原文
    expect(payload.queries).toHaveLength(1);
    const [captured] = payload.queries ?? [];
    expect(captured).toMatchObject({
      sourceId: "pg1",
      kind: "sql",
      payload: "SELECT channel, deals FROM deals",
    });
    expect(captured.id).toMatch(/^q_[0-9a-z]+$/);
    expect(payload.bindings).toEqual({
      chart: captured.id,
      table: captured.id,
    });
  });

  it("活看板捕获（P2-A）：derived 组件（计算列）不进 bindings，载荷不携带活看板字段", async () => {
    const derivedMsg = {
      ...boardMsg,
      content:
        "分析结论\n```ginkgo\nroot = Root([derived])\nderived = AnalyticsChart(\"bar\", \"t\", \"s\", \"channel\", [{\"channel\":\"TikTok Ads\",\"cac\":16.2},{\"channel\":\"Google Ads\",\"cac\":19.5}], [])\n```",
      toolInvocations: [
        {
          toolCallId: "call-1",
          toolName: "pg1_execute_sql",
          args: { sql: "SELECT channel, leads, deals FROM deals" },
          state: "result",
          result: {
            rows: [
              { channel: "TikTok Ads", leads: 4200, deals: 186 },
              { channel: "Google Ads", leads: 3800, deals: 152 },
            ],
          },
        },
      ],
    } as unknown as Message;
    const onFavorite = vi.fn<
      (input: import("@/hooks/useDashboards").FavoriteDashboardInput) => Promise<FavoriteResult>
    >(() => Promise.resolve({ ok: true }));
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, derivedMsg]}
        activeSources={[{ id: "pg1", name: "营销库" }]}
        onFavoriteDashboard={onFavorite}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /收藏看板（消息 b1）/ }));
    });

    const payload = onFavorite.mock.calls[0][0];
    expect(payload.queries).toBeUndefined();
    expect(payload.bindings).toBeUndefined();
  });

  it("已收藏（按 favoritedMessageIds 判定）显示实心态「已收藏」；再点仍调用（覆盖更新语义）", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(
      () => Promise.resolve({ ok: true })
    );
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        favoritedMessageIds={new Set(["b1"])}
        onFavoriteDashboard={onFavorite}
      />
    );

    const btn = screen.getByRole("button", { name: /已收藏，点击覆盖更新/ });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onFavorite).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("收藏已更新", "success");
  });

  it("收藏失败（如 413）→ toast 错误文案", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(() =>
      Promise.resolve({ ok: false, error: "dsl 超过 2097152 字符上限（2MB）" })
    );
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /收藏看板（消息 b1）/ }));
    });
    expect(toast).toHaveBeenCalledWith(
      "dsl 超过 2097152 字符上限（2MB）",
      "error"
    );
  });

  it("流式中的收藏按钮禁用", () => {
    render(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /收藏看板（消息 b1）/ })
    ).toBeDisabled();
  });

  it("收藏进行中按钮禁用；完成后恢复并 toast", async () => {
    let resolveFavorite!: (v: FavoriteResult) => void;
    const deferred = new Promise<FavoriteResult>((r) => {
      resolveFavorite = r;
    });
    const onFavorite = vi.fn(() => deferred);
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    const btn = screen.getByRole("button", { name: /收藏看板（消息 b1）/ });
    await act(async () => {
      fireEvent.click(btn);
    });

    // 进行中：禁用（loading 态）
    await waitFor(() => expect(btn).toBeDisabled());

    await act(async () => {
      resolveFavorite({ ok: true });
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(toast).toHaveBeenCalledWith("已收藏到看板库", "success");
  });

  it("未提供收藏回调时不显示收藏按钮", () => {
    render(<MessageList {...baseProps} messages={[userMsg, boardMsg]} />);
    expect(
      screen.queryByRole("button", { name: /收藏/ })
    ).not.toBeInTheDocument();
  });

  it("sourceNames 归档当前启用源名称", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(
      () => Promise.resolve({ ok: true })
    );
    render(
      <MessageList
        {...baseProps}
        activeSources={[
          { id: "gitlab", name: "GitLab" },
          { id: "zentao", name: "禅道" },
        ]}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /收藏看板（消息 b1）/ }));
    });
    expect(onFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNames: ["GitLab", "禅道"] })
    );
  });

  it("Thinking 卡片渲染停止响应按钮，点击触发 onStop", () => {
    const onStop = vi.fn();
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg]}
        status="submitted"
        onStop={onStop}
      />
    );

    const stopBtn = screen.getByRole("button", { name: /停止响应/ });
    expect(stopBtn).toBeInTheDocument();
    fireEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("消息内容与工具执行按顺序交错渲染", () => {
  const baseProps = {
    status: "ready" as const,
    error: undefined,
    activeSources: [
      { id: "gitlab", name: "GitLab" },
    ],
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("当包含 parts 时，文本与工具调用按实际执行顺序在 DOM 中交错呈现", () => {
    const interleavedMessage = {
      id: "a-interleaved",
      role: "assistant",
      content: "第一步：先查项目\n第二步：再查提交\n第三步：生成看板\n```ginkgo\n{\"type\":\"Stack\"}\n```",
      parts: [
        { type: "text", text: "第一步：先查项目" },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "call-1",
            toolName: "gitlab_list_projects",
            state: "result",
            args: {},
          },
        },
        { type: "text", text: "第二步：再查提交" },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "call-2",
            toolName: "gitlab_list_commits",
            state: "result",
            args: {},
          },
        },
        {
          type: "text",
          text: "第三步：生成看板\n```ginkgo\n{\"type\":\"Stack\"}\n```",
        },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, interleavedMessage]}
      />
    );

    const step1Text = screen.getByText("第一步：先查项目");
    const tool1 = screen.getByText(/\[GitLab\] 调用: gitlab_list_projects/);
    const step2Text = screen.getByText("第二步：再查提交");
    const tool2 = screen.getByText(/\[GitLab\] 调用: gitlab_list_commits/);
    const step3Text = screen.getByText("第三步：生成看板");
    const renderer = screen.getByTestId("renderer");

    // 验证严格先后顺序（Node.DOCUMENT_POSITION_FOLLOWING = 4）
    expect(step1Text.compareDocumentPosition(tool1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool1.compareDocumentPosition(step2Text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(step2Text.compareDocumentPosition(tool2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool2.compareDocumentPosition(step3Text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(step3Text.compareDocumentPosition(renderer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("连续多个工具调用自动合并在同一工具组内", () => {
    const multiToolMessage = {
      id: "a-multi-tool",
      role: "assistant",
      content: "开始并行查询\n查询完成",
      parts: [
        { type: "text", text: "开始并行查询" },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c1",
            toolName: "gitlab_list_projects",
            state: "result",
          },
        },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c2",
            toolName: "gitlab_list_branches",
            state: "result",
          },
        },
        { type: "text", text: "查询完成" },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, multiToolMessage]}
      />
    );

    const t1 = screen.getByText(/\[GitLab\] 调用: gitlab_list_projects/);
    const t2 = screen.getByText(/\[GitLab\] 调用: gitlab_list_branches/);

    // 两者属于同一父容器（space-y-2）
    expect(t1.closest(".space-y-2")).toBe(t2.closest(".space-y-2"));
  });

  it("流式传输中最后一步工具刚执行完时，按应用能力展示构思提示（看板语义/中性）", () => {
    const streamingMessage = {
      id: "a-streaming",
      role: "assistant",
      content: "准备查询",
      parts: [
        { type: "text", text: "准备查询" },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c1",
            toolName: "gitlab_list_projects",
            state: "result",
          },
        },
      ],
    } as unknown as Message;

    // 看板应用：analytics 语义文案
    const { rerender } = render(
      <MessageList
        {...baseProps}
        status="streaming"
        messageExtensions={ANALYTICS_EXTENSIONS}
        messages={[userMsg, streamingMessage]}
      />
    );
    expect(
      screen.getByText("数据查询已完成，大模型正在组织分析洞察并构建视觉看板...")
    ).toBeInTheDocument();

    // 非看板应用（如 general）：中性文案
    rerender(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, streamingMessage]}
      />
    );
    expect(screen.getByText("工具执行完成，正在组织回复...")).toBeInTheDocument();
  });

  it("思考过程 reasoning part 正常展示", () => {
    const reasoningMessage = {
      id: "a-reasoning",
      role: "assistant",
      content: "结论",
      parts: [
        { type: "reasoning", reasoning: "先分析用户需求" },
        { type: "text", text: "结论" },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, reasoningMessage]}
      />
    );

    expect(screen.getByText("思考过程")).toBeInTheDocument();
    expect(screen.getByText("先分析用户需求")).toBeInTheDocument();
    expect(screen.getByText("已完成思考")).toBeInTheDocument();
  });

  it("流式思考中展示活跃状态文案与指示器", () => {
    const streamingReasoningMsg = {
      id: "a-reasoning-streaming",
      role: "assistant",
      content: "",
      parts: [
        { type: "reasoning", reasoning: "正在规划数据探索方案..." },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, streamingReasoningMsg]}
      />
    );

    expect(screen.getByText("正在深度思考...")).toBeInTheDocument();
    expect(screen.getByText("思考中")).toBeInTheDocument();
    expect(screen.getByText("正在规划数据探索方案...")).toBeInTheDocument();
  });

  it("流式中超长思考只渲染尾部窗口（防长文每帧全量重排卡死），完成后回源全文", () => {
    const headMark = "HEAD_MARK_思考开头";
    const tailMark = "TAIL_MARK_思考结尾";
    const longReasoning = `${headMark}${"过程".repeat(2500)}${tailMark}`;
    const makeMsg = () =>
      ({
        id: "a-long-reasoning",
        role: "assistant",
        content: "",
        parts: [{ type: "reasoning", reasoning: longReasoning }],
      }) as unknown as Message;

    // 流式思考中：仅尾部窗口可见，开头被窗口截掉并有提示
    const { unmount } = render(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, makeMsg()]}
      />
    );
    expect(screen.getByText(/TAIL_MARK/)).toBeInTheDocument();
    expect(screen.queryByText(/HEAD_MARK/)).not.toBeInTheDocument();
    expect(screen.getByTestId("reasoning-tail-note")).toBeInTheDocument();
    unmount();

    // 思考完成：回源全文（开头结尾都在），无窗口提示
    render(<MessageList {...baseProps} messages={[userMsg, makeMsg()]} />);
    expect(screen.getByText(/HEAD_MARK/)).toBeInTheDocument();
    expect(screen.getByText(/TAIL_MARK/)).toBeInTheDocument();
    expect(screen.queryByTestId("reasoning-tail-note")).not.toBeInTheDocument();
  });

  it("声明 planConfirm 的应用：模型遗漏 PlanReviewCard 时按声明渲染确认按钮并可点击触发", () => {
    const onRendererAction = vi.fn();
    const textPlanMsg = {
      id: "a-text-plan",
      role: "assistant",
      content:
        "## 🔍 分析思路\n1. 活跃度排名\n\n## ❓ 澄清点说明\n\n请确认以下分析方案（点击卡片中的选项后一键确认）：",
    } as unknown as Message;

    // 未声明 messageExtensions：不渲染兜底按钮（general 行为）
    const { rerender } = render(
      <MessageList
        {...baseProps}
        messages={[userMsg, textPlanMsg]}
        onRendererAction={onRendererAction}
      />
    );
    expect(screen.queryByRole("button", { name: "按此思路开始分析" })).not.toBeInTheDocument();

    // analytics 声明 planConfirm：patterns 命中 → 渲染声明文案按钮
    rerender(
      <MessageList
        {...baseProps}
        messageExtensions={{
          planConfirm: {
            patterns: ["请确认以下分析方案", "澄清点说明", "分析思路确认"],
            label: "按此思路开始分析",
            actionPrompt:
              "请按上述已确认的分析思路开始执行，产出完整的分析报告与看板。",
          },
        }}
        messages={[userMsg, textPlanMsg]}
        onRendererAction={onRendererAction}
      />
    );
    const btn = screen.getByRole("button", { name: "按此思路开始分析" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRendererAction).toHaveBeenCalledWith(
      "请按上述已确认的分析思路开始执行，产出完整的分析报告与看板。"
    );
  });

  it("就绪看板提供钉选画布按钮，点击触发 onPinDashboard 回调", () => {
    const onPinDashboard = vi.fn();
    const pinBoardMsg = {
      id: "pin-1",
      role: "assistant",
      content: "分析报告\n```ginkgo\nroot = Root([MetricCard(\"销售\", 100)])\n```",
    } as unknown as Message;
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, pinBoardMsg]}
        onPinDashboard={onPinDashboard}
      />
    );
    const pinBtn = screen.getByRole("button", { name: /钉选看板/ });
    expect(pinBtn).toBeInTheDocument();
    fireEvent.click(pinBtn);
    expect(onPinDashboard).toHaveBeenCalledWith("pin-1", expect.stringContaining("root = Root"));
  });

  it("当模型调用 finish_task 但未产出 ginkgo 看板时，展示取数完成卡片与立即生成报告按钮并可点击触发", () => {
    const onRendererAction = vi.fn();
    const finishTaskMsg = {
      id: "a-finish-task",
      role: "assistant",
      content: "",
      parts: [
        { type: "reasoning", reasoning: "正在总结分析结果..." },
      ],
      toolInvocations: [
        {
          toolCallId: "call-finish",
          toolName: "finish_task",
          state: "result",
          args: {
            status: "completed",
            summary: "已完成 GitLab 活跃项目盘点，Top5 贡献 80.3% 活动量。",
          },
          result: {
            message: "已调用 finish_task",
          },
        },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messageExtensions={ANALYTICS_EXTENSIONS}
        messages={[userMsg, finishTaskMsg]}
        onRendererAction={onRendererAction}
      />
    );

    expect(screen.getByText("数据取数与分析计算已全部完成")).toBeInTheDocument();
    expect(
      screen.getByText("已完成 GitLab 活跃项目盘点，Top5 贡献 80.3% 活动量。")
    ).toBeInTheDocument();

    const generateBtn = screen.getByRole("button", { name: "立即生成报告与看板" });
    expect(generateBtn).toBeInTheDocument();
    fireEvent.click(generateBtn);
    expect(onRendererAction).toHaveBeenCalledWith(
      "数据取数与计算已全部完成。请立即基于上述结果，输出完整的 Markdown 深度分析报告以及 ```ginkgo 可视化动态看板代码块。"
    );
  });

  it("当模型输出由于 Token 上限截断未闭合时，展示输出已截断状态与继续生成按钮并可点击触发", () => {
    const onRendererAction = vi.fn();
    const truncatedMsg = {
      id: "a-truncated",
      role: "assistant",
      content:
        "## 分析报告\n数据如下...\n```ginkgo\nroot = Root([dash])\ndash = FocusLayout(\"项目\", \"副标\", main, side, detail)\ndailyChart = AnalyticsChart(\"bar\", \"提交节奏\"",
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, truncatedMsg]}
        onRendererAction={onRendererAction}
      />
    );

    expect(screen.getByText("输出已截断")).toBeInTheDocument();
    expect(
      screen.getByText("动态看板代码由于达到模型单次输出上限中途截断，未完整闭合")
    ).toBeInTheDocument();

    const resumeBtn = screen.getByRole("button", { name: "继续生成完整看板" });
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);
    expect(onRendererAction).toHaveBeenCalledWith(
      "上面的 ```ginkgo 看板代码由于达到长度上限被截断未闭合。请继续输出未完成的看板代码，确保完整闭合并渲染。"
    );
  });

  it("当同一条消息的多个 parts 重复输出相同看板与相同大标题报告时，自动去重仅渲染单个看板", () => {
    const duplicatePartsMsg = {
      id: "a-duplicate",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "text",
          text: "数据全部就绪。\n\n# 📈 经营复盘报告\n\n核心结论：业绩良好。\n\n```ginkgo\nroot = Root([MetricCard(\"MRR\", \"$100k\")])\n```",
        },
        {
          type: "tool-invocation",
          toolInvocation: {
            state: "result",
            toolCallId: "call_finish",
            toolName: "finish_task",
            args: { status: "completed" },
            result: { terminated: true },
          },
        },
        {
          type: "text",
          text: "# 📈 经营复盘报告\n\n核心结论：业绩良好。\n\n```ginkgo\nroot = Root([MetricCard(\"MRR\", \"$100k\")])\n```\n交付闭环 ✅",
        },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, duplicatePartsMsg]}
        onRendererAction={vi.fn()}
      />
    );

    // 看板标题栏仅出现 1 次，绝不重复出现 2 个看板
    const uiSpecHeaders = screen.getAllByText("动态看板");
    expect(uiSpecHeaders).toHaveLength(1);
    expect(screen.getByText("已就绪")).toBeInTheDocument();
  });

  it("当消息包含 finops_cost 注解时，在消息底部渲染耗时、tokens 与费用微标", () => {
    const costMsg = {
      id: "a-cost",
      role: "assistant",
      content: "分析完成",
      annotations: [
        {
          type: "finops_cost",
          model: "gpt-4o-mini",
          promptTokens: 1200,
          completionTokens: 350,
          totalTokens: 1550,
          costUsd: 0.0035,
          durationMs: 1500,
        },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, costMsg]}
        onRendererAction={vi.fn()}
      />
    );

    const badge = screen.getByTestId("finops-cost-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("⚡ 1.5s");
    expect(badge).toHaveTextContent("1,550 tokens");
    expect(badge).toHaveTextContent("$0.0035");
  });

  it("当消息包含 model_fallback 注解时，在消息内部渲染模型降级提示", () => {
    const fallbackMsg = {
      id: "a-fallback",
      role: "assistant",
      content: "降级生成结果",
      annotations: [
        {
          type: "model_fallback",
          from: "deepseek-reasoner",
          to: "deepseek-chat",
          reason: "rate_limit",
        },
      ],
    } as unknown as Message;

    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, fallbackMsg]}
        onRendererAction={vi.fn()}
      />
    );

    const fallbackBadge = screen.getByTestId("model-fallback-badge");
    expect(fallbackBadge).toBeInTheDocument();
    expect(fallbackBadge).toHaveTextContent("deepseek-reasoner");
    expect(fallbackBadge).toHaveTextContent("rate_limit");
    expect(fallbackBadge).toHaveTextContent("deepseek-chat");
  });
});


describe("控制面工具与应用能力注入", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const baseProps = {
    status: "ready" as const,
    error: undefined,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  /** finish_task（编排层终态协议）+ 普通工具的交错 parts 消息（AI SDK 中 toolInvocations 与 parts 并存） */
  const finishTaskMsg = {
    id: "a-finish",
    role: "assistant",
    content: "",
    parts: [
      {
        type: "tool-invocation",
        toolInvocation: {
          toolCallId: "call-sql",
          toolName: "pg_execute_sql",
          state: "result",
          args: { sql: "SELECT 1" },
        },
      },
      { type: "text", text: "分析结论已完整输出。" },
      {
        type: "tool-invocation",
        toolInvocation: {
          toolCallId: "call-finish",
          toolName: "finish_task",
          state: "result",
          args: { status: "completed", summary: "路由权限链路取数与分析完成" },
        },
      },
    ],
    toolInvocations: [
      {
        toolCallId: "call-sql",
        toolName: "pg_execute_sql",
        state: "result",
        args: { sql: "SELECT 1" },
      },
      {
        toolCallId: "call-finish",
        toolName: "finish_task",
        state: "result",
        args: { status: "completed", summary: "路由权限链路取数与分析完成" },
      },
    ],
  } as unknown as Message;

  it("finish_task 是控制面工具：不渲染为用户可见的工具条", () => {
    render(<MessageList {...baseProps} messages={[userMsg, finishTaskMsg]} />);

    // 业务工具正常渲染；控制面工具不出现
    expect(screen.getByText(/工具调用: pg_execute_sql/)).toBeInTheDocument();
    expect(screen.queryByText(/工具调用: finish_task/)).not.toBeInTheDocument();
  });

  it("未声明看板能力的应用（general）：不渲染一键产出看板的终态兜底卡片", () => {
    render(
      <MessageList {...baseProps} messages={[userMsg, finishTaskMsg]} />
    );

    expect(screen.queryByText("数据取数与分析计算已全部完成")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /立即生成报告与看板/ })).not.toBeInTheDocument();
  });

  it("声明看板能力的应用（analytics）：finish_task 无看板代码时渲染终态兜底卡片", () => {
    render(
      <MessageList
        {...baseProps}
        messageExtensions={ANALYTICS_EXTENSIONS}
        messages={[userMsg, finishTaskMsg]}
      />
    );

    expect(screen.getByText("数据取数与分析计算已全部完成")).toBeInTheDocument();
    expect(screen.getByText(/路由权限链路取数与分析完成/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /立即生成报告与看板/ })).toBeInTheDocument();
  });
});
