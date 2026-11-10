"use client";

/**
 * 图表注册表：chartType → 渲染器 的可换投影层（借鉴 DataEase「切换图表」：
 * 数据绑定不变，换 chartType 只换渲染器）。
 *
 * M1 第一批落地 4 个类型：stacked-bar / combo / donut / table；
 * bar/line/area/pie 沿用既有 AnalyticsChart（SpecChart 层 fallback），
 * 第二批（scatter/gauge/heatmap）与第三批迁移后续里程碑接入。
 *
 * 渲染器只负责图形本体（无卡片外框）：卡片 chrome 由 SpecChart 壳层统一提供，
 * 唯一例外 table 复用 DataTable（自带卡片）。颜色一律 CHART_COLORS token。
 */
import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ScatterChart,
  Scatter,
} from "recharts";
import { z } from "zod";
import { CHART_TYPES, type ChartType } from "@openui-analytics/chart-spec";
import {
  CHART_COLORS,
  thresholdCellFill,
  SEMANTIC_SOLID,
  type SeriesConfig,
  type ReferenceLineSpec,
  type ThresholdRule,
} from "./chartShared";
import { DataTable, type ColumnConfig } from "../data/DataTable";
import { GaugeProgress } from "../metrics/GaugeProgress";
import { ContributionHeatmap } from "./ContributionHeatmap";

// ===== 渲染入参（注册表内部契约）=====

/** 渲染期样式：M2 起支持条件样式（阈值着色）与辅助线（语义色名 → token 映射） */
export interface ChartStyleProps {
  showLegend?: boolean;
  showLabel?: boolean;
  thresholds?: readonly ThresholdRule[];
  referenceLines?: readonly ReferenceLineSpec[];
}

export interface RegistryRenderProps {
  /** 物化后的行数组（已经 parseArrayProp 收敛） */
  rows: Array<Record<string, unknown>>;
  /** 类别轴字段 = dims[0].field */
  dimField: string;
  /** 指标序列（key 有值；label 可选展示名） */
  measures: Array<{ key: string; label?: string }>;
  height?: number;
  style?: ChartStyleProps;
}

export interface ChartRendererEntry {
  type: ChartType;
  /** 一句话选型信号（供方法卡 chartPairing 与 prompt 选型规则引用） */
  when: string;
  /** 渲染入参 schema（注册表派发契约；ChartSpec 跨字段约束在 chart-spec 包） */
  zodSchema: z.ZodTypeAny;
  defaultStyle: ChartStyleProps;
  render: React.FC<RegistryRenderProps>;
}

/** 渲染入参基线 schema（各渲染器共享；增量 props 在各自条目扩展） */
export const registryRenderPropsSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  dimField: z.string().min(1),
  measures: z
    .array(z.object({ key: z.string().min(1), label: z.string().optional() }))
    .min(1),
  height: z.number().positive().optional(),
  style: z
    .object({
      showLegend: z.boolean().optional(),
      showLabel: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

// ===== 直角坐标公共框架 =====

const TOOLTIP_STYLE = {
  borderRadius: "8px",
  border: "1px solid var(--border)",
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
} as const;

interface FrameProps {
  rows: Array<Record<string, unknown>>;
  dimField: string;
  height: number;
  showLegend: boolean;
  /** 是否渲染右侧次轴（combo 双量纲） */
  dualAxis: boolean;
  /** 辅助线（均值/目标线，左轴数值） */
  referenceLines?: readonly ReferenceLineSpec[];
  children: React.ReactNode;
}

function CartesianFrame({
  rows,
  dimField,
  height,
  showLegend,
  dualAxis,
  referenceLines,
  children,
}: FrameProps) {
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={50}>
      <ComposedChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
        <XAxis dataKey={dimField} tick={{ fontSize: 12 }} tickLine={false} />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        {dualAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
        )}
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {showLegend && <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />}
        {(referenceLines ?? []).map((rl, i) => (
          <ReferenceLine
            key={`refline-${i}`}
            yAxisId="left"
            y={rl.value}
            stroke={SEMANTIC_SOLID[rl.color ?? "info"]}
            strokeDasharray="4 4"
            label={
              rl.label
                ? { value: rl.label, position: "insideTopRight", fontSize: 11 }
                : undefined
            }
          />
        ))}
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 空态占位（直角坐标/饼图渲染器共用） */
function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-xs text-foreground-faint"
      style={{ height, minHeight: height }}
    >
      暂无图表数据
    </div>
  );
}

// ===== 渲染器 =====

/** 堆叠柱状图：全部指标共用 stackId，展示构成随维度变化 */
const StackedBarRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  dimField,
  measures,
  height = 280,
  style,
}) => {
  if (rows.length === 0) return <EmptyChart height={height} />;
  const showLegend = style?.showLegend !== false;
  return (
    <CartesianFrame
      rows={rows}
      dimField={dimField}
      height={height}
      showLegend={showLegend}
      dualAxis={false}
      referenceLines={style?.referenceLines}
    >
      {measures.map((m, idx) => {
        const base = CHART_COLORS[idx % CHART_COLORS.length];
        return (
          <Bar
            key={`stacked-${m.key}`}
            yAxisId="left"
            dataKey={m.key}
            name={m.label || m.key}
            stackId="stack"
            fill={base}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          >
            {style?.thresholds?.length
              ? rows.map((row, i) => (
                  <Cell
                    key={`th-cell-${i}`}
                    fill={thresholdCellFill(row, style.thresholds) ?? base}
                  />
                ))
              : null}
          </Bar>
        );
      })}
    </CartesianFrame>
  );
};

/**
 * 柱线组合图（双量纲）：约定最后一个指标为折线（右轴），其余为柱（左轴）。
 * 单指标时退化为纯柱状图。典型：频次柱 + 累计占比线（帕累托）。
 */
const ComboRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  dimField,
  measures,
  height = 280,
  style,
}) => {
  if (rows.length === 0) return <EmptyChart height={height} />;
  const showLegend = style?.showLegend !== false;
  const lineMeasure = measures.length > 1 ? measures[measures.length - 1] : null;
  const barMeasures = lineMeasure ? measures.slice(0, -1) : measures;
  return (
    <CartesianFrame
      rows={rows}
      dimField={dimField}
      height={height}
      showLegend={showLegend}
      dualAxis={lineMeasure !== null}
      referenceLines={style?.referenceLines}
    >
      {barMeasures.map((m, idx) => {
        const base = CHART_COLORS[idx % CHART_COLORS.length];
        return (
          <Bar
            key={`combo-bar-${m.key}`}
            yAxisId="left"
            dataKey={m.key}
            name={m.label || m.key}
            fill={base}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {style?.thresholds?.length
              ? rows.map((row, i) => (
                  <Cell
                    key={`th-cell-${i}`}
                    fill={thresholdCellFill(row, style.thresholds) ?? base}
                  />
                ))
              : null}
          </Bar>
        );
      })}
      {lineMeasure && (
        <Line
          key={`combo-line-${lineMeasure.key}`}
          yAxisId="right"
          type="monotone"
          dataKey={lineMeasure.key}
          name={lineMeasure.label || lineMeasure.key}
          stroke={CHART_COLORS[(barMeasures.length + 1) % CHART_COLORS.length]}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      )}
    </CartesianFrame>
  );
};

/** 环形图：单指标占比（Donut = Pie innerRadius），颜色按行取 CHART_COLORS */
const DonutRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  dimField,
  measures,
  height = 280,
  style,
}) => {
  if (rows.length === 0) return <EmptyChart height={height} />;
  const dataKey = measures[0]?.key || "value";
  const showLabel = style?.showLabel !== false;
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={50}>
      <PieChart>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {style?.showLegend !== false && <Legend wrapperStyle={{ fontSize: "12px" }} />}
        <Pie
          data={rows}
          dataKey={dataKey}
          nameKey={dimField}
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="80%"
          label={showLabel}
          isAnimationActive={false}
        >
          {rows.map((_: unknown, index: number) => (
            <Cell key={`donut-cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
};

/** 明细表：复用 DataTable（自带卡片与搜索），列 = 维度 + 指标（右对齐数值） */
const TableRenderer: React.FC<RegistryRenderProps> = ({ rows, dimField, measures, style }) => {
  const columns: ColumnConfig[] = [
    { key: dimField, header: dimField, align: "left" },
    ...measures.map((m) => ({
      key: m.key,
      header: m.label || m.key,
      align: "right" as const,
      format: "number" as const,
    })),
  ];
  return (
    <DataTable
      data={rows}
      columns={columns}
      cellStyle={(row) => {
        const fill = thresholdCellFill(row, style?.thresholds);
        return fill ? { backgroundColor: fill, color: "var(--info-on-solid)" } : undefined;
      }}
    />
  );
};

/** 散点图：X=第一指标、Y=第二指标（契约限定恰好 2 指标） */
const ScatterRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  measures,
  height = 280,
  style,
}) => {
  if (rows.length === 0) return <EmptyChart height={height} />;
  const x = measures[0];
  const y = measures[1] ?? measures[0];
  const showLegend = style?.showLegend !== false;
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={50}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
        <XAxis
          type="number"
          dataKey={x.key}
          name={x.label || x.key}
          tick={{ fontSize: 12 }}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey={y.key}
          name={y.label || y.key}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {showLegend && <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />}
        <Scatter
          name={`${x.label || x.key} vs ${y.label || y.key}`}
          data={rows}
          fill={CHART_COLORS[0]}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
};

/** 仪表盘：单指标达成率（current=首行首指标聚合值，target=首条辅助线值） */
const GaugeRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  measures,
  style,
}) => {
  const first = rows[0];
  const current = first ? Number(first[measures[0]?.key ?? ""]) : NaN;
  const target = style?.referenceLines?.[0]?.value ?? current;
  if (!Number.isFinite(current)) {
    return (
      <div className="flex items-center justify-center text-xs text-foreground-faint" style={{ height: 220 }}>
        暂无图表数据
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <GaugeProgress current={current} target={target} />
    </div>
  );
};

/** 热力图：dimField→date 槽位、首指标→count（复用 ContributionHeatmap） */
const HeatmapRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  dimField,
  measures,
}) => {
  if (rows.length === 0) return <EmptyChart height={220} />;
  const countKey = measures[0]?.key ?? "count";
  const data = rows.map((row) => ({
    date: String(row[dimField] ?? ""),
    count: Number(row[countKey]) || 0,
  }));
  return <ContributionHeatmap title={undefined} data={data} />;
};

// ===== 注册表 =====

/** M1 第一批支持的 chartType（bar/line/area/pie 由 AnalyticsChart 兜底） */
export const supportedChartTypes = ["scatter", "gauge", "heatmap", "stacked-bar", "combo", "donut", "table"] as const;

const entries: ChartRendererEntry[] = [
  {
    type: "stacked-bar",
    when: "构成随维度变化：分类占比堆叠（如各渠道逐月花费构成）",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: { showLegend: true },
    render: StackedBarRenderer,
  },
  {
    type: "combo",
    when: "双量纲对比：柱表量、线表率或累计占比（帕累托、量+率）",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: { showLegend: true },
    render: ComboRenderer,
  },
  {
    type: "donut",
    when: "整体中各部分占比（单指标环形占比）",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: { showLegend: true, showLabel: true },
    render: DonutRenderer,
  },
  {
    type: "scatter",
    when: "两个指标的相关性/分布（如成本 vs 转化率）",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: { showLegend: true },
    render: ScatterRenderer,
  },
  {
    type: "gauge",
    when: "单指标目标达成率（聚合为单一值的 KPI，target 取首条辅助线）",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: {},
    render: GaugeRenderer,
  },
  {
    type: "heatmap",
    when: "时间/类目槽位的密度分布（如活跃度日历）",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: {},
    render: HeatmapRenderer,
  },
  {
    type: "table",
    when: "明细与汇总并看的全宽数据表",
    zodSchema: registryRenderPropsSchema,
    defaultStyle: {},
    render: TableRenderer,
  },
];

/** 注册表（type → entry，全枚举闭合：未落地类型显式为 null，bar/line/area/pie 由 AnalyticsChart 兜底） */
export const chartRegistry: Readonly<Record<ChartType, ChartRendererEntry | null>> =
  Object.fromEntries(
    CHART_TYPES.map((t) => [t, entries.find((e) => e.type === t) ?? null])
  ) as Readonly<Record<ChartType, ChartRendererEntry | null>>;

export function getChartRenderer(type: ChartType): ChartRendererEntry | null {
  return chartRegistry[type] ?? null;
}

/** 供 SpecChart 派发：渲染器入参的行数组规整 + 指标序列化简 */
export function normalizeRenderProps(
  rows: Array<Record<string, unknown>>,
  dimField: string,
  series: SeriesConfig[]
): Pick<RegistryRenderProps, "rows" | "dimField" | "measures"> {
  return {
    rows,
    dimField,
    measures: series.map((s) => ({ key: s.key, label: s.label })),
  };
}
