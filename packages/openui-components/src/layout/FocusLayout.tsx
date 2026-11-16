"use client";

import React from "react";
import { Crosshair } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { renderSafeLayout } from "../internal/layoutZone";

/**
 * 深钻归因布局模板：页头 + 主区（2/3 宽）+ 侧栏（1/3 窄列洞察）+ 底部明细。
 *
 * 区块（zone）语义约定——LLM 侧同步见 llm 包 serverFocusLayout：
 * - main     主分析区：AnalyticsChart / FunnelChart / RadarChart 等主图（有侧栏时占 2/3，无侧栏时占满）
 * - side     侧栏洞察（1/3 窄列，仅紧凑结论件）：InsightBox / GaugeProgress / 单个 MetricCard 或 MetricGrid；
 *            ActionPlanCard / ActivityTimeline / DataTable 等内容密集组件归 detail
 * - detail   底部全宽明细：DataTable / ActionPlanCard / ActivityTimeline
 * side/detail 可选，未提供的区块不渲染占位。
 */
export interface FocusLayoutProps {
  title?: string;
  subtitle?: string;
  controls?: React.ReactNode;
  main?: React.ReactNode;
  side?: React.ReactNode;
  detail?: React.ReactNode;
}

export const FocusLayout: React.FC<FocusLayoutProps> = ({
  title,
  subtitle,
  controls,
  main,
  side,
  detail,
}) => {
  return (
    <div className="@container space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-info-fg shrink-0" />
                <span className="truncate">{title}</span>
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <span className="text-[10px] bg-info-soft text-info-fg px-2.5 py-1 rounded-full font-semibold border border-info-border shrink-0">
            Deep Dive
          </span>
        </div>
      )}

      {/* 控制区：筛选器/时间区间选择器 */}
      {controls ? <div className="w-full">{controls}</div> : null}

      {/* 主区 + 侧栏：有侧栏时 2/3 + 1/3，无侧栏时主区占满，支持容器查询。
          列容器必须 min-w-0：Grid 子项默认 min-width:auto（不小于内容固有最小宽度），
          长文本/长数字/定宽图表会把 1/3 侧栏（或 2/3 主区）轨道撑破导致整行错位——
          ReportLayout 的 [&>*]:min-w-0 是同一防御的既有先例 */}
      {main || side ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 @lg:grid-cols-3 gap-4 items-start">
          {main ? (
            <div
              className={
                side
                  ? "lg:col-span-2 @lg:col-span-2 space-y-4 min-w-0"
                  : "lg:col-span-3 @lg:col-span-3 space-y-4 min-w-0"
              }
            >
              {main}
            </div>
          ) : null}
          {side ? <div className="space-y-4 min-w-0">{side}</div> : null}
        </div>
      ) : null}

      {/* 底部全宽明细区（min-w-0 同理防御定宽内容） */}
      {detail ? <div className="w-full space-y-4 min-w-0">{detail}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const FocusLayoutDef = defineComponent({
  name: "FocusLayout",
  description:
    "深钻归因布局模板：主图区（2/3 宽）+ 侧栏洞察（1/3 窄列）+ 底部明细。适用于单一主题的根因分析与归因（为什么 X 上升/下降）；多主题综合复盘用 ReportLayout",
  props: z.object({
    title: z.any().optional().describe("深钻主题标题，如：为什么 Q3 CAC 上升"),
    subtitle: z.any().optional().describe("聚焦对象或范围说明"),
    main: z.any().optional().describe("主分析区：核心趋势/对比图表数组"),
    side: z.any().optional().describe("侧栏洞察（1/3 窄列，仅紧凑结论件）：InsightBox/GaugeProgress/单个 MetricCard 或 MetricGrid 数组；ActionPlanCard/ActivityTimeline/DataTable 等内容密集组件须放 detail"),
    detail: z.any().optional().describe("底部全宽明细区：DataTable/ActionPlanCard/ActivityTimeline 数组"),
    controls: z.any().optional().describe("全局控制区：AnalyticsFilterBar 等筛选组件"),
  }),
  component: ({
    props,
    renderNode,
  }: {
    props?: Record<string, unknown>;
    renderNode?: (node?: unknown) => React.ReactNode;
  }) =>
    renderSafeLayout(
      "FocusLayout",
      (zone) => (
        <FocusLayout
          title={props?.title ? String(props.title) : undefined}
          subtitle={props?.subtitle ? String(props.subtitle) : undefined}
          controls={zone(props?.controls, "控制筛选")}
          main={zone(props?.main, "主分析区")}
          side={zone(props?.side, "侧栏洞察")}
          detail={zone(props?.detail, "数据明细")}
        />
      ),
      renderNode
    ),
});
