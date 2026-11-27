"use client";

import React, { useMemo } from "react";
import type { DashboardSpec, WidgetSpec } from "@ginkgolab/chart-spec";
import { MetricCard } from "../metrics/MetricCard";
import { GaugeProgress } from "../metrics/GaugeProgress";
import { AnalyticsChart } from "../charts/AnalyticsChart";
import { ComboChart } from "../charts/ComboChart";
import { FunnelChart } from "../charts/FunnelChart";
import { SpecChart } from "../charts/SpecChart";
import { DataTable } from "../data/DataTable";
import { RankingList } from "../data/RankingList";
import { InsightBox } from "../insight/InsightBox";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface DashboardSpecRendererProps {
  spec: DashboardSpec;
  /** 数据存储映射：queryId -> 行数据记录集 */
  dataStore?: Record<string, Array<Record<string, unknown>>>;
  className?: string;
}

/**
 * 单个声明式部件（Widget）渲染分发器
 */
function RenderWidget({
  widget,
  rows,
}: {
  widget: WidgetSpec;
  rows: Array<Record<string, unknown>>;
}) {
  const config = widget.chartConfig || {};

  switch (widget.type) {
    case "MetricCard": {
      const firstRow = rows[0] || {};
      const metricKey = widget.queryBinding?.metricFields?.[0] || Object.keys(firstRow)[0] || "value";
      const val = firstRow[metricKey] !== undefined ? String(firstRow[metricKey]) : String(config.value ?? "0");

      return (
        <MetricCard
          title={widget.title}
          value={val}
          change={config.change as string | undefined}
          trend={config.trend as "up" | "down" | "neutral" | undefined}
          subtext={widget.description || (config.subtext as string | undefined)}
        />
      );
    }

    case "AnalyticsChart": {
      const type = (config.type as "bar" | "line" | "area" | "pie") || "bar";
      const xAxisKey = widget.queryBinding?.dimensionField || (config.xAxisKey as string) || "name";
      const series = (config.series as Array<{ key: string; label?: string; color?: string }>) || undefined;

      return (
        <AnalyticsChart
          type={type}
          title={widget.title}
          description={widget.description}
          xAxisKey={xAxisKey}
          data={rows}
          series={series}
          height={config.height as number | undefined}
        />
      );
    }

    case "ComboChart": {
      const xAxisKey = widget.queryBinding?.dimensionField || (config.xAxisKey as string) || "name";
      const series = (config.series as Array<{ key: string; label?: string; type: "bar" | "line" }>) || [];

      return (
        <ComboChart
          title={widget.title}
          description={widget.description}
          xAxisKey={xAxisKey}
          data={rows}
          series={series}
          height={config.height as number | undefined}
        />
      );
    }

    case "DataTable": {
      const columns = (config.columns as Array<{ key: string; header: string }>) ||
        (rows.length > 0
          ? Object.keys(rows[0] as Record<string, unknown>).map((k) => ({
              key: k,
              header: k,
            }))
          : []);

      return (
        <DataTable
          title={widget.title}
          columns={columns}
          data={rows}
          searchable={config.searchable !== false}
        />
      );
    }

    case "FunnelChart": {
      return (
        <FunnelChart
          title={widget.title}
          description={widget.description}
          stages={rows as Array<{ name: string; value: number; conversion?: string }>}
          unit={config.unit as string | undefined}
        />
      );
    }

    case "GaugeProgress": {
      // 优先级：显式 config.current > 查询结果首行首列 > 0
      // （?? 与 ?: 混用需显式括号，否则 config.current 有值时会被错误忽略）
      const current = Number(
        config.current ??
          (rows[0] ? Object.values(rows[0] as Record<string, unknown>)[0] : 0)
      );
      const target = Number(config.target ?? 100);

      return (
        <GaugeProgress
          title={widget.title}
          description={widget.description}
          current={current}
          target={target}
          unit={config.unit as string | undefined}
          subtext={config.subtext as string | undefined}
        />
      );
    }

    case "RankingList": {
      return (
        <RankingList
          title={widget.title}
          subtitle={widget.description}
          items={rows as unknown as Array<{ label: string; value: number }>}
          maxDisplay={config.maxDisplay as number | undefined}
          valueFormat={config.valueFormat as "number" | "currency" | "percent" | "duration" | "text" | undefined}
        />
      );
    }

    case "InsightBox": {
      return (
        <InsightBox
          type={(config.type as "tip" | "info" | "warning" | "success") || "info"}
          title={widget.title}
          content={String(config.content || widget.description || "")}
        />
      );
    }

    case "SpecChart": {
      if (widget.chartSpec) {
        return (
          <SpecChart
            title={widget.title}
            spec={widget.chartSpec}
            data={rows}
            height={config.height as number | undefined}
          />
        );
      }
      return null;
    }

    default:
      return (
        <div className="p-4 rounded-xl border border-border bg-card text-xs text-foreground-faint">
          未支持的部件类型: {(widget as { type: string }).type}
        </div>
      );
  }
}

/**
 * DashboardSpec 2.0 声明式渲染顶层容器
 * - 彻底将数据流 (Data Pipelines) 与视图 (Views) 解耦
 * - 消费轻量 JSON 状态树，与 JSON Patch 增量编辑天然咬合
 */
export function DashboardSpecRenderer({
  spec,
  dataStore = {},
  className = "",
}: DashboardSpecRendererProps) {
  const { metadata, layout, widgets } = spec;

  // 根据 themeTokens 构造 CSS 变量内联样式（支持企业品牌定制）
  const themeStyle = useMemo(() => {
    if (!metadata.themeTokens) return undefined;
    const style: Record<string, string> = {};
    for (const [k, v] of Object.entries(metadata.themeTokens)) {
      style[`--${k}`] = v;
    }
    return style as React.CSSProperties;
  }, [metadata.themeTokens]);

  return (
    <div
      className={`w-full max-w-7xl mx-auto space-y-6 text-foreground font-sans ${className}`}
      style={themeStyle}
    >
      {/* 头部标题与描述 */}
      <div className="border-b border-border pb-4 pt-1">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {metadata.title}
        </h1>
        {metadata.description && (
          <p className="mt-1 text-xs text-foreground-subtle">
            {metadata.description}
          </p>
        )}
      </div>

      {/* 栅格排版容器：列数与间距由 layout.columns/gap 驱动（schema 允许 1..24 列） */}
      <div className="space-y-4">
        {layout.rows.map((row) => (
          <div
            key={row.id}
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gap: `${layout.gap * 0.25}rem`,
            }}
          >
            {row.widgets.map((item) => {
              const widget = widgets[item.id];
              if (!widget) return null;

              // 解析数据：优先匹配 queryBinding 的数据，回退至 staticData，再次回退至 []
              const qId = widget.queryBinding?.queryId;
              const rows = ((qId && dataStore[qId]) || widget.staticData || []) as Array<Record<string, unknown>>;

              // colSpan 以实际栅格列数封顶，避免超宽声明静默溢出
              const span = Math.min(item.colSpan || layout.columns, layout.columns);

              return (
                <div
                  key={item.id}
                  style={{ gridColumn: `span ${span} / span ${span}` }}
                  className="min-w-0"
                >
                  <ComponentSafeWrapper name={widget.title}>
                    <RenderWidget widget={widget} rows={rows} />
                  </ComponentSafeWrapper>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
