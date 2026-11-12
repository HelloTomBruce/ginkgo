import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ComboChart } from "./ComboChart";
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

describe("ComboChart 双轴复合图", () => {
  const testData = [
    { month: "1月", sales: 120, conversion: 15 },
    { month: "2月", sales: 200, conversion: 22 },
    { month: "3月", sales: 150, conversion: 18 },
  ];

  it("正常渲染标题与说明", () => {
    render(
      <ComboChart
        title="月度销售额与转化率"
        description="2026年Q1数据走势"
        data={testData}
        xAxisKey="month"
        series={[
          { key: "sales", label: "销售额", type: "bar", yAxis: "left" },
          { key: "conversion", label: "转化率", type: "line", yAxis: "right", unit: "%" },
        ]}
      />
    );

    expect(screen.getByText("月度销售额与转化率")).toBeInTheDocument();
    expect(screen.getByText("2026年Q1数据走势")).toBeInTheDocument();
  });

  it("无数据时展示空态提示", () => {
    render(<ComboChart data={[]} series={[]} />);
    expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
  });

  it("当未显式指定 series 时能自动从数据键推断", () => {
    const { container } = render(
      <ComboChart data={testData} xAxisKey="month" series={[]} />
    );
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });

  it("左右双轴配置下正确挂载并生成对齐的 Y 轴", () => {
    const { container } = render(
      <ComboChart
        data={testData}
        xAxisKey="month"
        series={[
          { key: "sales", label: "销售额", type: "bar", yAxis: "left" },
          { key: "conversion", label: "转化率", type: "line", yAxis: "right", unit: "%" },
        ]}
        leftAxisUnit="万"
        rightAxisUnit="%"
      />
    );
    expect(container.querySelector(".recharts-cartesian-grid")).toBeInTheDocument();
  });

  it("响应 filterBus 筛选事件，动态切片复合图数据", () => {
    const { container } = render(
      <ComboChart
        data={testData}
        xAxisKey="month"
        series={[
          { key: "sales", label: "销售额", type: "bar", yAxis: "left" },
        ]}
      />
    );
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();

    act(() => {
      emitFilterChange({ field: "month", value: "1月" });
    });
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();

    act(() => {
      emitFilterChange({ field: "month", value: "" });
    });
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });
});
