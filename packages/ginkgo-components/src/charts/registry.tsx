"use client";

/**
 * 图表注册表：chartType → 渲染器 的可换投影层（借鉴 DataEase「切换图表」：
 * 数据绑定不变，换 chartType 只换渲染器）。
 *
 * 全枚举闭合：CHART_TYPES 共 11 个类型（bar / stacked-bar / line / area / combo /
 * pie / donut / scatter / gauge / heatmap / table）全部在本注册表落地，
 * SpecChart 统一经注册表派发，不再有 AnalyticsChart fallback 分支。
 *
 * 渲染器只负责图形本体（无卡片外框）：卡片 chrome 由 SpecChart 壳层统一提供，
 * 例外：table 复用 DataTable、gauge 复用 GaugeProgress（各自自带卡片）。
 * 颜色一律 CHART_COLORS / 语义 solid token。
 */
import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Area,
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
import {
  CHART_TYPES,
  type ChartType,
  type MeasureFormat,
} from "@ginkgo/chart-spec";
import {
  CHART_COLORS,
  thresholdCellFill,
  formatMeasureValue,
  SEMANTIC_SOLID,
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
  /** 类别轴字段 = dims[0].field（直角坐标 X 轴 / 饼图 nameKey） */
  dimField: string;
  /** 全部维度列（契约 ≤3；table 渲染全部维度，key=字段名、label 可选展示名） */
  dimFields: Array<{ key: string; label?: string }>;
  /** 指标序列（key 有值；label 可选展示名；format 见 chart-spec MEASURE_FORMATS） */
  measures: Array<{ key: string; label?: string; format?: MeasureFormat }>;
  height?: number;
  style?: ChartStyleProps;
}

export interface ChartRendererEntry {
  type: ChartType;
  render: React.FC<RegistryRenderProps>;
}

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

/** 阈值规则按行覆盖柱色（有规则时每行一个 Cell，未命中回退基础系列色） */
function thresholdCells(
  rows: Array<Record<string, unknown>>,
  thresholds: readonly ThresholdRule[] | undefined,
  base: string
) {
  return thresholds?.length
    ? rows.map((row, i) => (
        <Cell key={`th-cell-${i}`} fill={thresholdCellFill(row, thresholds) ?? base} />
      ))
    : null;
}

// ===== 渲染器 =====

/** 柱状图：多指标并列分组柱（阈值规则按行覆盖柱色） */
const BarRenderer: React.FC<RegistryRenderProps> = ({
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
            key={`bar-${m.key}`}
            yAxisId="left"
            dataKey={m.key}
            name={m.label || m.key}
            fill={base}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {thresholdCells(rows, style?.thresholds, base)}
          </Bar>
        );
      })}
    </CartesianFrame>
  );
};

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
            {thresholdCells(rows, style?.thresholds, base)}
          </Bar>
        );
      })}
    </CartesianFrame>
  );
};

/** 折线图：多指标单调平滑折线（辅助线沿用框架） */
const LineRenderer: React.FC<RegistryRenderProps> = ({
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
      {measures.map((m, idx) => (
        <Line
          key={`line-${m.key}`}
          yAxisId="left"
          type="monotone"
          dataKey={m.key}
          name={m.label || m.key}
          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls
          isAnimationActive={false}
        />
      ))}
    </CartesianFrame>
  );
};

/** 面积图：多指标半透明面积（与既有 AnalyticsChart area 同构：无 stackId 叠加） */
const AreaRenderer: React.FC<RegistryRenderProps> = ({
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
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        return (
          <Area
            key={`area-${m.key}`}
            yAxisId="left"
            type="monotone"
            dataKey={m.key}
            name={m.label || m.key}
            stroke={color}
            fill={color}
            fillOpacity={0.2}
            isAnimationActive={false}
          />
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
            {thresholdCells(rows, style?.thresholds, base)}
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
          connectNulls
          isAnimationActive={false}
        />
      )}
    </CartesianFrame>
  );
};

/** 饼图：单指标占比（实心饼 = Pie 无内径），颜色按行取 CHART_COLORS */
const PieRenderer: React.FC<RegistryRenderProps> = ({
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
          outerRadius="80%"
          label={showLabel}
          isAnimationActive={false}
        >
          {rows.map((_: unknown, index: number) => (
            <Cell key={`pie-cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
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

/**
 * 明细表：复用 DataTable（自带卡片与搜索），列 = 全部维度 + 指标（右对齐）。
 * 指标单元格按 meas[].format 渲染（Intl.NumberFormat，见 chartShared）；
 * 阈值着色按行对象身份映射回原始行判定（格式化串无法回解数值）。
 */
const TableRenderer: React.FC<RegistryRenderProps> = ({
  rows,
  dimField,
  dimFields,
  measures,
  style,
}) => {
  const dims = dimFields.length > 0 ? dimFields : [{ key: dimField }];
  const displayRows = rows.map((row) => {
    const display: Record<string, unknown> = { ...row };
    for (const m of measures) {
      // 未声明 format 保持原始值（数值列排序不退化为字符串序）
      display[m.key] = m.format ? formatMeasureValue(row[m.key], m.format) : row[m.key];
    }
    return display;
  });
  const rawRowByDisplay = new Map(displayRows.map((display, i) => [display, rows[i]]));
  const columns: ColumnConfig[] = [
    ...dims.map((d) => ({ key: d.key, header: d.label || d.key, align: "left" as const })),
    ...measures.map((m) => ({
      key: m.key,
      header: m.label || m.key,
      align: "right" as const,
    })),
  ];
  return (
    <DataTable
      data={displayRows}
      columns={columns}
      interactiveFilter={false}
      cellStyle={(row) => {
        const fill = thresholdCellFill(
          rawRowByDisplay.get(row) ?? row,
          style?.thresholds
        );
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

/**
 * 仪表盘：单指标达成率（current=首行首指标聚合值，target=首条辅助线值）。
 * height 暂不透传：GaugeProgress 无尺寸入参（SVG 半径固定），属既有组件
 * 契约限制，留待后续为其补尺寸支持时接入。
 */
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

const entries: ChartRendererEntry[] = [
  { type: "bar", render: BarRenderer },
  { type: "stacked-bar", render: StackedBarRenderer },
  { type: "line", render: LineRenderer },
  { type: "area", render: AreaRenderer },
  { type: "combo", render: ComboRenderer },
  { type: "pie", render: PieRenderer },
  { type: "donut", render: DonutRenderer },
  { type: "scatter", render: ScatterRenderer },
  { type: "gauge", render: GaugeRenderer },
  { type: "heatmap", render: HeatmapRenderer },
  { type: "table", render: TableRenderer },
];

/** 注册表（type → entry，全枚举闭合覆盖 CHART_TYPES；未注册类型防御性为 null） */
export const chartRegistry: Readonly<Record<ChartType, ChartRendererEntry | null>> =
  Object.fromEntries(
    CHART_TYPES.map((t) => [t, entries.find((e) => e.type === t) ?? null])
  ) as Readonly<Record<ChartType, ChartRendererEntry | null>>;

export function getChartRenderer(type: ChartType): ChartRendererEntry | null {
  return chartRegistry[type] ?? null;
}
