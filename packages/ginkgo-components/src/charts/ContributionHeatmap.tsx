"use client";

import React, { useState } from "react";
import { Flame } from "lucide-react";
import { parseArrayProp } from "../internal/parseProp";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface HeatmapDataPoint {
  date?: string;
  day?: string;
  count: number;
  label?: string;
}

export interface ContributionHeatmapProps {
  title?: string;
  description?: string;
  data: HeatmapDataPoint[];
  color?: "green" | "blue" | "purple";
}

export const ContributionHeatmap: React.FC<ContributionHeatmapProps> = ({
  title = "研发与提交活跃度热力图",
  description,
  data = [],
  color = "green",
}) => {
  const safeData: HeatmapDataPoint[] = parseArrayProp(data).map((d) => ({
    date: d.date ? String(d.date) : undefined,
    day: d.day ? String(d.day) : undefined,
    count: typeof d.count === "number" ? d.count : Number(d.count) || 0,
    label: d.label ? String(d.label) : undefined,
  }));

  const defaultTheme = {
    0: "bg-muted",
    1: "bg-success-scale-1",
    2: "bg-success-scale-2",
    3: "bg-success-scale-3",
    4: "bg-success-scale-4",
  };

  const colorThemes = {
    green: defaultTheme,
    blue: {
      0: "bg-muted",
      1: "bg-info-scale-1",
      2: "bg-info-scale-2",
      3: "bg-info-scale-3",
      4: "bg-info-scale-4",
    },
    purple: {
      0: "bg-muted",
      1: "bg-brand-scale-1",
      2: "bg-brand-scale-2",
      3: "bg-brand-scale-3",
      4: "bg-brand-scale-4",
    },
  }[color] || defaultTheme;

  const getLevel = (count: number) => {
    if (count <= 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 8) return 3;
    return 4;
  };

  const totalCount = safeData.reduce((acc, curr) => acc + curr.count, 0);

  // 悬浮气泡：fixed 定位脱离 overflow-x-auto 裁剪上下文
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: React.ReactNode;
  } | null>(null);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-success-fg" />
            <span>{title}</span>
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        <span className="text-[10px] bg-success-soft text-success-fg px-2.5 py-0.5 rounded-full font-semibold">
          累计 {totalCount} 次
        </span>
      </div>

      <div className="overflow-x-auto pb-2">
        {safeData.length === 0 ? (
          <div className="text-xs text-foreground-faint text-center py-4">
            暂无热力图数据
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              {safeData.map((item, idx) => {
                const level = getLevel(item.count) as 0 | 1 | 2 | 3 | 4;
                const cellBg = colorThemes[level];
                return (
                  <div
                    key={`heatmap-cell-${idx}`}
                    className={`w-5 h-5 rounded-sm ${cellBg} transition-transform hover:scale-125 cursor-pointer`}
                    title={`${item.date || item.day || `点位 ${idx + 1}`}: ${item.count} 次`}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTooltip({
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                        text: (
                          <>
                            {item.date || item.day || item.label || `#${idx + 1}`}: <span className="font-bold">{item.count}</span>
                          </>
                        ),
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })}
            </div>

            {/* 图例 */}
            <div className="flex items-center justify-end gap-1.5 text-[10px] text-foreground-faint pt-2">
              <span>低频</span>
              <div className={`w-3 h-3 rounded-xs ${colorThemes[0]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[1]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[2]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[3]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[4]}`} />
              <span>高频</span>
            </div>
          </div>
        )}
      </div>

      {/* 悬浮气泡：fixed 定位，渲染在 overflow 容器外，避免被裁剪 */}
      {tooltip && (
        <div
          className="fixed z-20 bg-surface-inverse text-white text-[10px] py-1 px-2 rounded shadow-lg whitespace-nowrap pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, calc(-100% - 4px))",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};

// ===== UiSpec 组件库定义 =====
export const ContributionHeatmapDef = defineComponent({
  name: "ContributionHeatmap",
  description: "活跃度与密度热力图，用于研发团队 Commit 活跃度分布、时段流量或高频获客密度分析",
  props: z.object({
    title: z.any().optional().describe("热力图标题"),
    description: z.any().optional().describe("说明描述"),
    data: z.any().optional().describe("热力分布数据点"),
    color: z.any().optional().describe("色系主题"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const color = (["green", "blue", "purple"].includes(String(props?.color)) ? props.color : "green") as "green" | "blue" | "purple";
    return (
      <ComponentSafeWrapper name="ContributionHeatmap">
        <ContributionHeatmap
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          data={props?.data as React.ComponentProps<typeof ContributionHeatmap>["data"]}
          color={color}
        />
      </ComponentSafeWrapper>
    );
  },
});
