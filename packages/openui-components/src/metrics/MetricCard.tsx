import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  subtext?: string;
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
}) => {
  const displayValue =
    typeof value === "object" || value === null || value === undefined
      ? "-"
      : value;
  const strValue = String(displayValue);

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow min-w-0 flex flex-col justify-between h-full">
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
              className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                trend === "up"
                  ? "bg-success-soft text-success-fg-strong"
                  : trend === "down"
                  ? "bg-danger-soft text-danger-fg-strong"
                  : "bg-muted text-foreground-subtle"
              }`}
            >
              {trend === "up" && <TrendingUp className="w-3 h-3 shrink-0" />}
              {trend === "down" && <TrendingDown className="w-3 h-3 shrink-0" />}
              {trend === "neutral" && <Minus className="w-3 h-3 shrink-0" />}
              <span className="whitespace-nowrap">{change}</span>
            </div>
          )}
        </div>
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
  description: "展示单个核心数据指标（KPI）、变化幅度及趋势徽章",
  props: z.object({
    title: z.any().optional().describe("指标卡片标题"),
    value: z.any().optional().describe("指标核心数值"),
    change: z.any().optional().describe("环比或同比变化率"),
    trend: z.any().optional().describe("趋势方向"),
    subtext: z.any().optional().describe("补充说明文本"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = String(props?.title ?? "核心指标");
    const value = props?.value !== undefined ? (props.value as string | number) : "-";
    const change = props?.change ? String(props.change) : undefined;
    const trend = (["up", "down", "neutral"].includes(String(props?.trend)) ? props.trend : "neutral") as "up" | "down" | "neutral";
    const subtext = props?.subtext ? String(props.subtext) : undefined;

    return (
      <ComponentSafeWrapper name="MetricCard">
        <MetricCard title={title} value={value} change={change} trend={trend} subtext={subtext} />
      </ComponentSafeWrapper>
    );
  },
});
