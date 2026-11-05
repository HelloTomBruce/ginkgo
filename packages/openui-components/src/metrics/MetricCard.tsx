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

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  trend = "neutral",
  subtext,
}) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-2xl font-bold tracking-tight text-foreground">
          {typeof value === "object" ? "-" : (value ?? "-")}
        </div>
        {change && (
          <div
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
              trend === "up"
                ? "bg-success-soft text-success-fg-strong"
                : trend === "down"
                ? "bg-danger-soft text-danger-fg-strong"
                : "bg-muted text-foreground-subtle"
            }`}
          >
            {trend === "up" && <TrendingUp className="w-3 h-3" />}
            {trend === "down" && <TrendingDown className="w-3 h-3" />}
            {trend === "neutral" && <Minus className="w-3 h-3" />}
            <span>{change}</span>
          </div>
        )}
      </div>
      {subtext && (
        <div className="mt-2 text-xs text-muted-foreground">
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
