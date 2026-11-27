import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { DashboardSpecRenderer } from "./DashboardSpecRenderer";
import { applyJsonPatch, type DashboardSpec } from "@ginkgolab/chart-spec";

afterEach(() => {
  cleanup();
});

describe("DashboardSpecRenderer 声明式看板容器测试", () => {
  const baseSpec: DashboardSpec = {
    version: "2.0",
    metadata: {
      id: "dash_sales",
      title: "季度营销与转化全景",
      description: "跨渠道获客效率深度复盘",
    },
    queries: {
      q_leads: {
        sourceId: "pg_main",
        sql: "SELECT channel, leads FROM channel_stats",
      },
      q_kpi: {
        sourceId: "pg_main",
        sql: "SELECT 12480 AS total_leads",
      },
    },
    layout: {
      columns: 12,
      gap: 4,
      rows: [
        {
          id: "r1",
          widgets: [{ id: "w_kpi", colSpan: 12 }],
        },
        {
          id: "r2",
          widgets: [{ id: "w_table", colSpan: 12 }],
        },
      ],
    },
    widgets: {
      w_kpi: {
        type: "MetricCard",
        title: "总线索量",
        queryBinding: {
          queryId: "q_kpi",
          metricFields: ["total_leads"],
        },
      },
      w_table: {
        type: "DataTable",
        title: "各渠道线索明细",
        queryBinding: {
          queryId: "q_leads",
        },
      },
    },
  };

  const sampleDataStore = {
    q_kpi: [{ total_leads: "12,480" }],
    q_leads: [
      { channel: "TikTok Ads", leads: 4200 },
      { channel: "Google Ads", leads: 3800 },
    ],
  };

  it("正常渲染看板元数据与数据注入组件", () => {
    render(
      <DashboardSpecRenderer spec={baseSpec} dataStore={sampleDataStore} />
    );

    expect(screen.getByText("季度营销与转化全景")).toBeInTheDocument();
    expect(screen.getByText("跨渠道获客效率深度复盘")).toBeInTheDocument();
    expect(screen.getByText("总线索量")).toBeInTheDocument();
    expect(screen.getByText("12,480")).toBeInTheDocument();
    expect(screen.getByText("TikTok Ads")).toBeInTheDocument();
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
  });

  it("模拟大模型 JSON Patch 增量微调：仅修改标题与卡片类型，数据完全保留", () => {
    // 模拟大模型输出两个 Patch 操作
    const patchResult = applyJsonPatch(baseSpec, [
      { op: "replace", path: "/metadata/title", value: "Q3 终极复盘新标题" },
      { op: "replace", path: "/widgets/w_kpi/title", value: "更新后的核心线索指标" },
    ]);

    expect(patchResult.success).toBe(true);

    const { rerender } = render(
      <DashboardSpecRenderer spec={baseSpec} dataStore={sampleDataStore} />
    );
    expect(screen.getByText("季度营销与转化全景")).toBeInTheDocument();

    // 内存应用 Patch 重绘
    rerender(
      <DashboardSpecRenderer spec={patchResult.doc} dataStore={sampleDataStore} />
    );

    expect(screen.getByText("Q3 终极复盘新标题")).toBeInTheDocument();
    expect(screen.getByText("更新后的核心线索指标")).toBeInTheDocument();
    // 绑定的数据依然存在，无需重新拉取网络或重新生成行
    expect(screen.getByText("12,480")).toBeInTheDocument();
  });

  it("GaugeProgress：config.current 显式值优先于查询行，且空行集不崩溃", () => {
    const spec: DashboardSpec = {
      version: "2.0",
      metadata: { id: "dash_gauge", title: "完成率" },
      queries: {},
      layout: {
        columns: 12,
        gap: 4,
        rows: [{ id: "r1", widgets: [{ id: "w_g", colSpan: 6 }] }],
      },
      widgets: {
        w_g: {
          type: "GaugeProgress",
          title: "季度目标完成率",
          queryBinding: { queryId: "q_missing" },
          chartConfig: { current: 68, target: 100, unit: "%" },
        },
      },
    };

    // queryBinding 指向不存在的 queryId → rows 为空，不得抛错；且必须采用 config.current
    render(<DashboardSpecRenderer spec={spec} />);
    expect(screen.getByText("季度目标完成率")).toBeInTheDocument();
    expect(screen.getAllByText(/68/).length).toBeGreaterThan(0);
  });

  it("layout.columns=24 时栅格模板按 24 列生成，colSpan>12 不再被 12 栅格截断", () => {
    const spec: DashboardSpec = {
      version: "2.0",
      metadata: { id: "dash_wide", title: "宽栅格看板" },
      queries: {},
      layout: {
        columns: 24,
        gap: 2,
        rows: [{ id: "r1", widgets: [{ id: "w_wide", colSpan: 16 }] }],
      },
      widgets: {
        w_wide: { type: "InsightBox", title: "洞察", chartConfig: { content: "内容" } },
      },
    };

    const { container } = render(<DashboardSpecRenderer spec={spec} />);
    const gridEl = container.querySelector('[style*="grid-template-columns"]');
    expect(gridEl).not.toBeNull();
    expect((gridEl as HTMLElement).style.gridTemplateColumns).toBe(
      "repeat(24, minmax(0, 1fr))"
    );
    const spanEl = container.querySelector('[style*="grid-column"]');
    expect((spanEl as HTMLElement).style.gridColumn).toBe("span 16 / span 16");
  });
});
