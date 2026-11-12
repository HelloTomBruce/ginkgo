"use client";

import React from "react";
import { LayoutTemplate } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { renderSafeLayout } from "../internal/layoutZone";

/**
 * BI 报表布局模板：页头 + KPI 横排区 + 双列图表区 + 全宽明细区 + 结论区。
 *
 * 区块（zone）语义约定——LLM 侧同步见 llm 包 serverReportLayout：
 * - kpis     直接传 MetricCard 数组（模板自动 4 列栅格，勿再嵌 MetricGrid）
 * - charts   图表数组（lg 双列；奇数个时末张自动占满整行）
 * - detail   DataTable 等全宽明细
 * - insights InsightBox / ActionPlanCard 结论区（纵向堆叠）
 * 全部区块可选，未提供的区块不渲染占位。
 */
export interface ReportLayoutProps {
  title?: string;
  subtitle?: string;
  controls?: React.ReactNode;
  kpis?: React.ReactNode;
  charts?: React.ReactNode;
  detail?: React.ReactNode;
  insights?: React.ReactNode;
}

export const ReportLayout: React.FC<ReportLayoutProps> = ({
  title,
  subtitle,
  controls,
  kpis,
  charts,
  detail,
  insights,
}) => {
  return (
    <div className="@container space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4 text-info-fg shrink-0" />
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
            BI Report
          </span>
        </div>
      )}

      {/* 控制区：筛选器/时间区间选择器 */}
      {controls ? <div className="w-full">{controls}</div> : null}

      {/* KPI 横排区：手机 2 列，桌面 4 列，支持容器查询自适应 */}
      {kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-4 @sm:grid-cols-2 @md:grid-cols-4 gap-3 sm:gap-4 min-w-0">
          {kpis}
        </div>
      ) : null}

      {/* 双列图表区：奇数个时末张占满整行，支持容器查询，强制子卡片最小宽度为 0 避免 Recharts SVG 宽度震荡死循环 */}
      {charts ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 @lg:grid-cols-2 gap-4 lg:[&>*:nth-child(odd):last-child]:col-span-2 @lg:[&>*:nth-child(odd):last-child]:col-span-2 [&>*]:min-w-0">
          {charts}
        </div>
      ) : null}

      {/* 全宽明细区 */}
      {detail ? <div className="w-full space-y-4">{detail}</div> : null}

      {/* 结论区 */}
      {insights ? <div className="space-y-3">{insights}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const ReportLayoutDef = defineComponent({
  name: "ReportLayout",
  description:
    "BI 报表布局模板：页头 + KPI 横排区 + 双列图表区 + 全宽明细区 + 结论区，适用于周期性经营/获客/迭代综合复盘；单一主题直接用 Root 平铺",
  props: z.object({
    title: z.any().optional().describe("报表标题"),
    subtitle: z.any().optional().describe("周期或范围说明，如：2026 Q3 · 全渠道"),
    kpis: z.any().optional().describe("KPI 横排区：直接传 MetricCard 数组，勿嵌 MetricGrid"),
    charts: z.any().optional().describe("双列图表区：AnalyticsChart/FunnelChart/RadarChart 等数组"),
    detail: z.any().optional().describe("全宽明细区：DataTable 数组"),
    insights: z.any().optional().describe("结论区：InsightBox/ActionPlanCard 数组"),
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
      "ReportLayout",
      (zone) => (
        <ReportLayout
          title={props?.title ? String(props.title) : undefined}
          subtitle={props?.subtitle ? String(props.subtitle) : undefined}
          controls={zone(props?.controls, "控制筛选")}
          kpis={zone(props?.kpis, "核心指标")}
          charts={zone(props?.charts, "图表分析")}
          detail={zone(props?.detail, "数据明细")}
          insights={zone(props?.insights, "结论洞察")}
        />
      ),
      renderNode
    ),
});
