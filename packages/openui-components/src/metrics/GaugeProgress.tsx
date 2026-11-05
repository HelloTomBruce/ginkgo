"use client";

import React from "react";
import { Target, CheckCircle2, AlertCircle } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface GaugeProgressProps {
  title?: string;
  description?: string;
  current: number | string;
  target: number | string;
  unit?: string;
  subtext?: string;
}

export const GaugeProgress: React.FC<GaugeProgressProps> = ({
  title,
  description,
  current = 0,
  target = 100,
  unit = "",
  subtext,
}) => {
  const numCurrent = typeof current === "number" ? current : Number(current) || 0;
  const numTarget = typeof target === "number" ? target : Number(target) || 100;

  const percentage = numTarget > 0 ? Math.max(0, Math.round((numCurrent / numTarget) * 100)) : 0;
  const isCompleted = percentage >= 100;
  const isWarning = percentage < 60;

  const strokeColor = isCompleted
    ? "var(--success-solid)"
    : isWarning
    ? "var(--warning-solid)"
    : "var(--info-solid)";

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div>
          {title && (
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Target className="w-4 h-4 text-info-fg" />
              <span>{title}</span>
            </h3>
          )}
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        <div
          className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
            isCompleted
              ? "bg-success-soft text-success-fg-strong"
              : isWarning
              ? "bg-warning-soft text-warning-fg-strong"
              : "bg-info-soft text-info-fg-strong"
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          <span>{isCompleted ? "已达成" : `完成度 ${percentage}%`}</span>
        </div>
      </div>

      <div className="space-y-2 mt-4">
        <div className="flex justify-between items-baseline text-xs">
          <span className="text-muted-foreground font-medium">
            当前进度
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-foreground font-mono">
              {numCurrent.toLocaleString()}
            </span>
            <span className="text-xs text-foreground-faint">
              / {numTarget.toLocaleString()} {unit}
            </span>
          </div>
        </div>

        {/* 进度条 */}
        <div className="h-3 w-full bg-muted rounded-full overflow-hidden p-0.5">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(percentage, 100)}%`,
              backgroundColor: strokeColor,
            }}
          />
        </div>

        <div className="flex justify-between items-center text-[11px] text-foreground-faint pt-1">
          <span>
            {numCurrent >= numTarget
              ? `超额完成 ${(numCurrent - numTarget).toLocaleString()} ${unit}`
              : `距离目标还需 ${(numTarget - numCurrent).toLocaleString()} ${unit}`}
          </span>
          {subtext && <span className="font-medium text-muted-foreground">{subtext}</span>}
        </div>
      </div>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const GaugeProgressDef = defineComponent({
  name: "GaugeProgress",
  description: "目标达成度与核心进度条组件，用于展示年度/季度 KPI、预算消耗进度与超额达成状况",
  props: z.object({
    title: z.any().optional().describe("目标指标标题"),
    description: z.any().optional().describe("副标题或周期说明"),
    current: z.any().optional().describe("当前实际完成数值"),
    target: z.any().optional().describe("预定目标数值"),
    unit: z.any().optional().describe("指标单位，如：美元、元、单、%"),
    subtext: z.any().optional().describe("底部辅助说明"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="GaugeProgress">
        <GaugeProgress
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          current={props?.current as number | string}
          target={props?.target as number | string}
          unit={props?.unit ? String(props.unit) : undefined}
          subtext={props?.subtext ? String(props.subtext) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});
