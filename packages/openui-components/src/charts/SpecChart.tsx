"use client";

import React from "react";
import { BarChart3 } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { parseChartSpec, type ChartSpec } from "@openui-analytics/chart-spec";
import { parseArrayProp } from "../internal/parseProp";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";
import { onFilterChange } from "./filterBus";
import { AnalyticsChart } from "./AnalyticsChart";
import { getChartRenderer, normalizeRenderProps } from "./registry";
import type { SeriesConfig } from "./chartShared";

/**
 * SpecChart —— 语义声明图表：LLM 输出「维度×指标×过滤」的 ChartSpec 而非渲染数据，
 * 图形类型是 spec.chartType 之上的可换渲染器（换图不换数据绑定）。
 *
 * 数据流：生成期 data 可由 LLM 物化填充（静态快照）；刷新期服务端按 spec
 * 物化（specMaterialize）回填 data——全程零 LLM。fallback：bar/line/area/pie
 * 四类沿用既有 AnalyticsChart，注册表类型走 registry 渲染器。
 */

export interface SpecChartProps {
  title?: string;
  /** ChartSpec：dims/meas/filters/chartType/style/sourceId（见 chart-spec 包契约） */
  spec: Partial<ChartSpec> | string;
  /** 数据表名（刷新物化用；静态渲染不需要） */
  table?: string;
  /** 已物化的行数组（生成期快照或刷新回填产物） */
  data?: Array<Record<string, unknown>>;
  height?: number;
}

export const SpecChart: React.FC<SpecChartProps> = ({
  title,
  spec,
  // table 供刷新物化（dashboardRefresh）与筛选联动（preview-query）取数使用
  table,
  data = [],
  height = 280,
}) => {
  // spec 可能是对象或 JSON 字符串（LLM 输出容错，与 parseArrayProp 同哲学）
  let parsedSpec: ChartSpec | null = null;
  if (typeof spec === "string") {
    try {
      parsedSpec = parseChartSpec(JSON.parse(spec));
    } catch {
      parsedSpec = null;
    }
  } else if (spec && typeof spec === "object") {
    parsedSpec = parseChartSpec(spec);
  }

  // ===== 筛选联动（M2-4）：订阅 filterBus，字段命中时自行重物化回填 =====
  // liveRows = 物化行（初始为 props.data 快照；筛选变化后为 preview-query 产物）。
  // props.data 变化（刷新回填）→ 渲染期调整 state（React 官方 adjust-state-on-prop-change
  // 模式，避免 effect 内同步 setState 触发级联渲染）
  const [liveRows, setLiveRows] = React.useState(data);
  const [lastSnapshot, setLastSnapshot] = React.useState(data);
  if (data !== lastSnapshot) {
    setLastSnapshot(data);
    setLiveRows(data);
  }

  const specKey = parsedSpec ? JSON.stringify(parsedSpec) : "";
  React.useEffect(() => {
    if (!parsedSpec || !table) return;
    const owns = new Set<string>([
      ...parsedSpec.dims.map((d) => d.field),
      ...(parsedSpec.filters ?? []).map((f) => f.field),
    ]);
    let seq = 0; // 竞态守卫：快速连续筛选时仅最新请求可回填
    const off = onFilterChange((event) => {
      if (!owns.has(event.field)) return; // 声明式作用域：字段不属于本图表则不响应
      const rest = (parsedSpec.filters ?? []).filter((f) => f.field !== event.field);
      const merged: ChartSpec = {
        ...parsedSpec,
        filters: [...rest, { field: event.field, op: "eq", value: event.value }],
      };
      const mySeq = ++seq;
      fetch("/api/dashboards/preview-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: merged.sourceId, table, spec: merged }),
      })
        .then((r) => r.json())
        .then((body: { rows?: Array<Record<string, unknown>> }) => {
          if (mySeq !== seq) return; // 已有更新的筛选请求，丢弃过期响应
          if (Array.isArray(body.rows)) setLiveRows(body.rows);
        })
        .catch(() => {
          // 联动失败静默保留旧数据（与刷新 stale 降级同哲学）
        });
    });
    return off;
    // specKey 稳定化：parsedSpec 对象每渲染重建，用序列化串做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, table]);

  const rows = parseArrayProp(liveRows);
  const chartType = parsedSpec?.chartType;

  const body = (() => {
    if (!parsedSpec || !chartType) {
      return (
        <div className="text-xs text-warning-fg bg-warning-soft rounded-lg px-3 py-2">
          图表声明（ChartSpec）无效，请重新生成
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div
          className="flex items-center justify-center text-xs text-foreground-faint"
          style={{ height, minHeight: height }}
        >
          暂无图表数据
        </div>
      );
    }

    const series: SeriesConfig[] = parsedSpec.meas.map((m) => ({
      key: m.field,
      label: m.label || m.field,
    }));

    // 注册表类型：走统一渲染器投影
    const entry = getChartRenderer(chartType);
    if (entry) {
      const Renderer = entry.render;
      const style = {
        showLegend: parsedSpec.style?.showLegend,
        showLabel: parsedSpec.style?.showLabel,
        thresholds: parsedSpec.style?.thresholds,
        referenceLines: parsedSpec.style?.referenceLines,
      };
      return (
        <Renderer
          {...normalizeRenderProps(rows, parsedSpec.dims[0].field, series)}
          height={height}
          style={style}
        />
      );
    }

    // fallback：直角坐标四类沿用既有 AnalyticsChart（换图不换数据）；
    // 其余类型无注册渲染器时给明确占位（不应到达：chart-spec 枚举与注册表对齐维护）
    if (chartType !== "bar" && chartType !== "line" && chartType !== "area" && chartType !== "pie") {
      return (
        <div className="text-xs text-warning-fg bg-warning-soft rounded-lg px-3 py-2">
          图形类型 {chartType} 暂无渲染器
        </div>
      );
    }
    return (
      <AnalyticsChart
        type={chartType}
        data={rows}
        xAxisKey={parsedSpec.dims[0].field}
        series={series}
        height={height}
      />
    );
  })();

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      {(title || parsedSpec?.title) && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-info-fg shrink-0" />
            <span>{title || parsedSpec?.title}</span>
          </h3>
        </div>
      )}
      <ComponentSafeWrapper name="SpecChart">{body}</ComponentSafeWrapper>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const SpecChartDef = defineComponent({
  name: "SpecChart",
  description:
    "语义声明图表：声明维度/指标/过滤/图形类型（ChartSpec），数据由系统物化回填；支持换图不换数据（改 spec.chartType）",
  props: z.object({
    title: z.any().optional().describe("图表标题（缺省用 spec.title）"),
    spec: z.any().describe("ChartSpec 对象：dims/meas/chartType 必填，filters/sort/limit/style/sourceId 可选"),
    table: z.any().optional().describe("数据表名（刷新物化用）"),
    data: z.any().optional().describe("物化行数组（生成期快照或刷新回填）"),
    height: z.any().optional().describe("图表高度（像素）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <SpecChart
        title={props?.title ? String(props.title) : undefined}
        spec={props?.spec as SpecChartProps["spec"]}
        table={props?.table ? String(props.table) : undefined}
        data={props?.data as Array<Record<string, unknown>>}
        height={typeof props?.height === "number" ? props.height : 280}
      />
    );
  },
});
