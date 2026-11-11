"use client";

import React from "react";
import { Users2 } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { renderSafeLayout } from "../internal/layoutZone";

/**
 * 留存与队列流转分析模板：
 * 页头 + 控制区 + 留存核心 KPI + 队列矩阵/热力区 + 衰减走势区 + 归因结论区。
 *
 * 区块（zone）语义约定：
 * - controls       全局控制区（如 AnalyticsFilterBar 筛选渠道/版本）
 * - kpis           核心留存指标（次留/7日留存/30日留存 MetricCard 数组）
 * - heatmapMatrix  队列留存热力矩阵（DataTable 或 ContributionHeatmap）
 * - decayTrend     留存衰减曲线（AnalyticsChart 或 ComboChart）
 * - verdict        归因结论与改进建议（InsightBox 或 ActionPlanCard）
 */
export interface CohortRetentionLayoutProps {
  title?: string;
  subtitle?: string;
  controls?: React.ReactNode;
  kpis?: React.ReactNode;
  heatmapMatrix?: React.ReactNode;
  decayTrend?: React.ReactNode;
  verdict?: React.ReactNode;
}

export const CohortRetentionLayout: React.FC<CohortRetentionLayoutProps> = ({
  title,
  subtitle,
  controls,
  kpis,
  heatmapMatrix,
  decayTrend,
  verdict,
}) => {
  return (
    <div className="@container space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Users2 className="w-4 h-4 text-info-fg shrink-0" />
                <span className="truncate">{title}</span>
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          <span className="text-[10px] bg-info-soft text-info-fg px-2.5 py-1 rounded-full font-semibold border border-info-border shrink-0">
            Cohort Retention
          </span>
        </div>
      )}

      {/* 控制区 */}
      {controls ? <div className="w-full">{controls}</div> : null}

      {/* 核心 KPI 留存指标网格：支持容器查询 */}
      {kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-4 @sm:grid-cols-2 @md:grid-cols-4 gap-3 sm:gap-4 min-w-0">
          {kpis}
        </div>
      ) : null}

      {/* 队列留存热力矩阵区 */}
      {heatmapMatrix ? (
        <div className="w-full space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            留存队列矩阵
          </div>
          {heatmapMatrix}
        </div>
      ) : null}

      {/* 留存衰减趋势走势区 */}
      {decayTrend ? (
        <div className="w-full space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            生命周期留存衰减曲线
          </div>
          {decayTrend}
        </div>
      ) : null}

      {/* 归因结论区 */}
      {verdict ? <div className="space-y-3">{verdict}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const CohortRetentionLayoutDef = defineComponent({
  name: "CohortRetentionLayout",
  description:
    "留存与队列流转分析模板：包含核心留存指标（次留/7日留存）、队列矩阵、衰减曲线及归因结论，适用于用户增长、版本次日/长周期留存复盘",
  props: z.object({
    title: z.any().optional().describe("模板标题，如：2026年Q3用户全周期留存追踪"),
    subtitle: z.any().optional().describe("口径说明或周期"),
    controls: z.any().optional().describe("控制筛选区：AnalyticsFilterBar 等"),
    kpis: z.any().optional().describe("留存核心指标：次留/7留/30留 MetricCard 数组"),
    heatmapMatrix: z.any().optional().describe("队列留存矩阵：DataTable 等组件"),
    decayTrend: z.any().optional().describe("留存衰减趋势走势图：AnalyticsChart 或 ComboChart"),
    verdict: z.any().optional().describe("归因结论区：InsightBox 数组"),
  }),
  component: ({
    props,
    renderNode,
  }: {
    props?: Record<string, unknown>;
    renderNode?: (node?: unknown) => React.ReactNode;
  }) =>
    renderSafeLayout(
      "CohortRetentionLayout",
      (zone) => (
        <CohortRetentionLayout
          title={props?.title ? String(props.title) : undefined}
          subtitle={props?.subtitle ? String(props.subtitle) : undefined}
          controls={zone(props?.controls, "控制筛选")}
          kpis={zone(props?.kpis, "核心指标")}
          heatmapMatrix={zone(props?.heatmapMatrix, "留存矩阵")}
          decayTrend={zone(props?.decayTrend, "衰减趋势")}
          verdict={zone(props?.verdict, "留存结论")}
        />
      ),
      renderNode
    ),
});
