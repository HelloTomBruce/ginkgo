import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AnalyticsFilterBar } from "./AnalyticsFilterBar";
import { emitFilterChange, onFilterChange } from "../charts/filterBus";

// 声明/演示子组件调用 useSetFieldValue / useTriggerAction（依赖 Renderer 上下文）：
// 测试环境 mock 掉这两个 hook（其余 react-lang 导出保持原样）
vi.mock("@openuidev/react-lang", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@openuidev/react-lang")>();
  return {
    ...mod,
    useSetFieldValue: () => vi.fn(),
    useTriggerAction: () => vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AnalyticsFilterBar 声明模式（M2-3）", () => {
  const filterField = { sourceId: "pg1", field: "channel", table: "deals" };

  function stubFetch(values: string[], extra: Record<string, unknown> = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ values, ...extra }),
        })
      ) as unknown as typeof fetch
    );
  }

  it("经 distinct 端点拉取选项并渲染下拉", async () => {
    stubFetch(["TikTok Ads", "Google Ads"]);
    render(<AnalyticsFilterBar title="渠道筛选" filterField={filterField} />);
    await waitFor(() => screen.getByText("TikTok Ads"));
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/datasources/pg1/distinct?field=channel&table=deals"
    );
  });

  it("选择后广播 filterBus + 写入 $filter.<field>", async () => {
    stubFetch(["A", "B"]);
    const received: Array<{ field: string; value: string }> = [];
    onFilterChange((e) => received.push(e));
    render(<AnalyticsFilterBar title="渠道筛选" filterField={filterField} />);
    await waitFor(() => screen.getByText("A"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "B" } });
    await waitFor(() => expect(received).toEqual([{ field: "channel", value: "B" }]));
  });

  it("truncated → 退化为输入框 + 提示", async () => {
    stubFetch([], { truncated: true });
    render(<AnalyticsFilterBar title="渠道筛选" filterField={filterField} />);
    await waitFor(() => screen.getByPlaceholderText(/选项过多/));
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("端点错误（error 字段）→ 提示且不崩", async () => {
    stubFetch([], { error: "数据源不可用: pg1" });
    render(<AnalyticsFilterBar title="渠道筛选" filterField={filterField} />);
    await waitFor(() => screen.getByPlaceholderText(/数据源不可用/));
  });

  it("演示模式（无 filterField）保持既有三控件行为", () => {
    render(<AnalyticsFilterBar />);
    expect(screen.getByText("聚焦推广渠道")).toBeInTheDocument();
    expect(screen.getByText("模拟总预算 ($)")).toBeInTheDocument();
    expect(screen.getByText("应用筛选并钻取")).toBeInTheDocument();
  });
});

describe("filterBus", () => {
  it("订阅可取消", () => {
    const got: string[] = [];
    const off = onFilterChange((e) => got.push(e.value));
    emitFilterChange({ field: "f", value: "1" });
    off();
    emitFilterChange({ field: "f", value: "2" });
    expect(got).toEqual(["1"]);
  });
});
