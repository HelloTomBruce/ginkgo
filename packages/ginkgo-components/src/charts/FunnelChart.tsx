"use client";

import React from "react";
import { Filter, ArrowDown } from "lucide-react";
import { parseArrayProp } from "../internal/parseProp";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface FunnelStage {
  name: string;
  value: number;
  conversion?: string;
  subtext?: string;
}

export interface FunnelChartProps {
  title?: string;
  description?: string;
  stages: FunnelStage[];
  unit?: string;
}

/* 阶段色读取主题 token --chart-1..6（见应用层 globals.css），
 * 用 color-mix 提亮渐变终点，保持原 600→500 的层次观感 */
const STAGE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export const FunnelChart: React.FC<FunnelChartProps> = ({
  title,
  description,
  stages = [],
  unit = "",
}) => {
  // 安全容错：确保 stages 始终为有效数组
  const safeStages: FunnelStage[] = parseArrayProp(stages).map((s) => ({
    name: String(s.name || s.label || s.stage || "阶段"),
    value: typeof s.value === "number" ? s.value : Number(s.value) || 0,
    conversion: s.conversion ? String(s.conversion) : undefined,
    subtext: s.subtext ? String(s.subtext) : undefined,
  }));

  if (safeStages.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-xs text-xs text-foreground-faint text-center">
        暂无漏斗转化数据
      </div>
    );
  }

  const maxValue = Math.max(...safeStages.map((s) => s.value), 1);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-info-fg" />
              <span>{title}</span>
            </h3>
          )}
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {safeStages.map((stage, idx) => {
          const widthPercent = Math.max(Math.round((stage.value / maxValue) * 100), 12);
          const stageColor = STAGE_COLORS[idx % STAGE_COLORS.length];
          // 连接线渲染在当前阶段下方，流失率应对应「当前阶段 → 下一阶段」
          const nextValue = idx < safeStages.length - 1 ? safeStages[idx + 1].value : null;
          const dropOffRate =
            nextValue !== null && stage.value > 0
              ? Math.round(((stage.value - nextValue) / stage.value) * 100)
              : 0;

          return (
            <div key={`stage-${idx}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-muted text-foreground-subtle flex items-center justify-center font-mono font-semibold text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="font-medium text-foreground-strong">
                    {stage.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground font-mono">
                    {stage.value.toLocaleString()} {unit}
                  </span>
                  {stage.conversion && (
                    <span className="text-[10px] bg-success-soft text-success-fg px-1.5 py-0.5 rounded font-medium">
                      转化: {stage.conversion}
                    </span>
                  )}
                </div>
              </div>

              {/* 进度条与梯级 */}
              <div className="h-7 w-full bg-muted rounded-lg p-0.5 overflow-hidden flex items-center">
                <div
                  className="h-full rounded-md transition-all duration-500 flex items-center justify-end px-2"
                  style={{
                    width: `${widthPercent}%`,
                    background: `linear-gradient(to right, ${stageColor}, color-mix(in oklch, ${stageColor}, white 18%))`,
                  }}
                >
                  <span className="text-[10px] text-white/90 font-medium">
                    {widthPercent}%
                  </span>
                </div>
              </div>

              {/* 阶段间转化率/流失提示 */}
              {idx < safeStages.length - 1 && (
                <div className="flex items-center gap-1.5 text-[10px] text-foreground-faint px-7">
                  <ArrowDown className="w-3 h-3 text-foreground-faint" />
                  <span>流失率: ~{dropOffRate}%</span>
                  {stage.subtext && <span>• {stage.subtext}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ===== UiSpec 组件库定义 =====
export const FunnelChartDef = defineComponent({
  name: "FunnelChart",
  description: "业务转化旅程与流失漏斗图，用于获客流程、商机跟进与留存各阶段流失率分析",
  props: z.object({
    title: z.any().optional().describe("漏斗图标题"),
    description: z.any().optional().describe("说明描述"),
    stages: z.any().optional().describe("漏斗阶段序列"),
    unit: z.any().optional().describe("数值单位，如：人、单、美元"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="FunnelChart">
        <FunnelChart
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          stages={props?.stages as React.ComponentProps<typeof FunnelChart>["stages"]}
          unit={props?.unit ? String(props.unit) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});
