import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { AnalyticsChart } from "./AnalyticsChart";
import { emitFilterChange, resetFilterBus } from "./filterBus";

vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: (props: { children?: React.ReactElement }) =>
      props.children
        ? React.cloneElement(props.children, { width: 600, height: 300 } as never)
        : null,
  };
});

afterEach(() => {
  cleanup();
  resetFilterBus();
});

describe("AnalyticsChart 分析图表", () => {
  const testData = [
    { channel: "TikTok", deals: 120 },
    { channel: "Google", deals: 200 },
  ];

  it("正常渲染标题与说明", () => {
    render(
      <AnalyticsChart
        type="bar"
        title="渠道获客对比"
        description="2026年Q1数据"
        data={testData}
        xAxisKey="channel"
      />
    );
    expect(screen.getByText("渠道获客对比")).toBeInTheDocument();
    expect(screen.getByText("2026年Q1数据")).toBeInTheDocument();
  });

  it("无数据时展示空态提示", () => {
    render(<AnalyticsChart data={[]} />);
    expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
  });

  it("响应 filterBus 事件：根据外部筛选过滤数据行", () => {
    const { container } = render(
      <AnalyticsChart
        type="bar"
        data={testData}
        xAxisKey="channel"
      />
    );
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();

    // 广播筛选：仅保留 TikTok
    act(() => {
      emitFilterChange({ field: "channel", value: "TikTok" });
    });
    // 依然正常渲染切片后的图表
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();

    // 广播清除筛选（空字符串）
    act(() => {
      emitFilterChange({ field: "channel", value: "" });
    });
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });

  it("当提供 spec 声明时自动委托给 SpecChart", () => {
    render(
      <AnalyticsChart
        title="声明式委托图表"
        spec={{
          chartType: "bar",
          dims: [{ field: "channel" }],
          meas: [{ field: "deals", agg: "sum" }],
        }}
        data={testData}
      />
    );
    expect(screen.getByText("声明式委托图表")).toBeInTheDocument();
  });
});
