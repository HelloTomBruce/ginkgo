import React, { useId } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { parseArrayProp } from "../internal/parseProp";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  subtext?: string;
  /** 可选的迷你走势图数据点（如近 7 日/14 日趋势） */
  sparkline?: number[];
}

/**
 * 根据数值字符长度平滑降级字号，保证所有数字和单位 100% 完整直接呈现。
 * 严禁使用省略号（...）截断业务关键数值。结合 flex-wrap，在狭窄栅格中自动换行对齐。
 */
function getValueSizeClass(len: number): string {
  if (len >= 16) return "text-lg sm:text-xl";
  if (len >= 12) return "text-xl sm:text-2xl";
  if (len >= 8) return "text-2xl sm:text-3xl";
  return "text-3xl sm:text-4xl";
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  trend = "neutral",
  subtext,
  sparkline,
}) => {
  const gradId = useId();
  const displayValue =
    typeof value === "object" || value === null || value === undefined
      ? "-"
      : value;
  const strValue = String(displayValue);

  // 解析并清洗 sparkline 数据
  const validPoints = React.useMemo(() => {
    if (!Array.isArray(sparkline) || sparkline.length < 2) return null;
    const nums = sparkline.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    return nums.length >= 2 ? nums : null;
  }, [sparkline]);

  const sparklineSvg = React.useMemo(() => {
    if (!validPoints) return null;
    const min = Math.min(...validPoints);
    const max = Math.max(...validPoints);
    const range = max - min === 0 ? 1 : max - min;
    const width = 120;
    const height = 28;
    const padding = 2;

    const coords = validPoints.map((val, idx) => {
      const x = padding + (idx / (validPoints.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const linePath = `M ${coords.join(" L ")}`;
    const areaPath = `M ${coords[0]} L ${coords.join(" L ")} L ${width - padding},${height} L ${padding},${height} Z`;

    const strokeColor =
      trend === "up"
        ? "var(--success-solid, #10b981)"
        : trend === "down"
        ? "var(--danger-solid, #ef4444)"
        : "var(--chart-1, #3b82f6)";

    return (
      <div className="w-full h-7 mt-2 overflow-hidden" data-testid="metric-sparkline">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.18} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} className="transition-opacity duration-300 ease-out" />
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-[d,stroke] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        </svg>
      </div>
    );
  }, [validPoints, trend, gradId]);

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] min-w-0 flex flex-col justify-between h-full">
      {/* 顶部区域：标题与核心指标 */}
      <div>
        {/* 标题区：自然多行折行，完整展示业务含义，绝不用 ... 截断 */}
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground break-words leading-snug">
          {title}
        </div>

        {/* 核心指标与变化率区：采用 flex-wrap 弹性换行 + 平滑阶梯字号，确保数字完全展示 */}
        <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1.5 min-w-0">
          <div
            className={`font-bold tracking-tight text-foreground tabular-nums break-all leading-tight ${getValueSizeClass(
              strValue.length
            )}`}
          >
            {displayValue}
          </div>
          {change && (
            <div
              className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                trend === "up"
                  ? "bg-success-soft text-success-fg-strong border-success-border/70"
                  : trend === "down"
                  ? "bg-danger-soft text-danger-fg-strong border-danger-border/70"
                  : "bg-surface-sunken text-foreground-subtle border-border"
              }`}
            >
              {trend === "up" && <TrendingUp className="w-3 h-3 shrink-0" />}
              {trend === "down" && <TrendingDown className="w-3 h-3 shrink-0" />}
              {trend === "neutral" && <Minus className="w-3 h-3 shrink-0" />}
              <span className="whitespace-nowrap">{change}</span>
            </div>
          )}
        </div>

        {/* 趋势微图（若提供） */}
        {sparklineSvg}
      </div>

      {/* 底部区域：补充说明文案（自然折行，完整交代计算口径或归因背景） */}
      {subtext && (
        <div className="mt-2.5 text-xs text-muted-foreground break-words leading-relaxed">
          {subtext}
        </div>
      )}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const MetricCardDef = defineComponent({
  name: "MetricCard",
  description: "展示单个核心数据指标（KPI）、变化幅度及趋势徽章，支持可选 sparkline 迷你走势图",
  props: z.object({
    title: z.any().optional().describe("指标卡片标题"),
    value: z.any().optional().describe("指标核心数值"),
    change: z.any().optional().describe("环比或同比变化率"),
    trend: z.any().optional().describe("趋势方向"),
    subtext: z.any().optional().describe("补充说明文本"),
    sparkline: z.any().optional().describe("迷你走势图数值数组，如 [10, 15, 12, 20]"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = String(props?.title ?? "核心指标");
    const value = props?.value !== undefined ? (props.value as string | number) : "-";
    const change = props?.change ? String(props.change) : undefined;
    const trend = (["up", "down", "neutral"].includes(String(props?.trend)) ? props.trend : "neutral") as "up" | "down" | "neutral";
    const subtext = props?.subtext ? String(props.subtext) : undefined;
    const sparkline = props?.sparkline ? parseArrayProp(props.sparkline).map(Number) : undefined;

    return (
      <ComponentSafeWrapper name="MetricCard">
        <MetricCard
          title={title}
          value={value}
          change={change}
          trend={trend}
          subtext={subtext}
          sparkline={sparkline}
        />
      </ComponentSafeWrapper>
    );
  },
});
