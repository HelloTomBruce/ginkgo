"use client";

import React from "react";
import { ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { renderSafeLayout } from "../internal/layoutZone";

/**
 * 监控巡检与告警排查模板：
 * 头部状态指示横幅 + 控制筛选槽 + 异动指标网格 + 异常明细区 + 应急动作区。
 *
 * 区块（zone）语义约定：
 * - statusBanner 状态横幅或总结
 * - controls     全局控制/筛选条（AnalyticsFilterBar）
 * - anomalies    异动指标网格（MetricCard 数组）
 * - details      异常明细/时序事件流（DataTable / ActivityTimeline）
 * - actions      处置建议/应急动作（ActionPlanCard / ActionButton）
 */
export interface MonitoringLayoutProps {
  title?: string;
  subtitle?: string;
  status?: "normal" | "warning" | "critical";
  statusBanner?: React.ReactNode;
  controls?: React.ReactNode;
  anomalies?: React.ReactNode;
  details?: React.ReactNode;
  actions?: React.ReactNode;
}

export const MonitoringLayout: React.FC<MonitoringLayoutProps> = ({
  title,
  subtitle,
  status = "normal",
  statusBanner,
  controls,
  anomalies,
  details,
  actions,
}) => {
  const statusConfig = {
    normal: {
      label: "系统正常",
      badgeClass: "bg-success-soft text-success-fg-strong border-success-border",
      dotClass: "bg-success-solid",
      icon: CheckCircle2,
    },
    warning: {
      label: "异常关注",
      badgeClass: "bg-warning-soft text-warning-fg-strong border-warning-border",
      dotClass: "bg-warning-solid",
      icon: AlertTriangle,
    },
    critical: {
      label: "严重告警",
      badgeClass: "bg-danger-soft text-danger-fg-strong border-danger-border",
      dotClass: "bg-danger-solid",
      icon: ShieldAlert,
    },
  }[status];

  const StatusIcon = statusConfig.icon;

  return (
    <div className="@container space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <StatusIcon className="w-4 h-4 shrink-0 text-info-fg" />
                <span className="truncate">{title}</span>
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>

          <div
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border shrink-0 ${statusConfig.badgeClass}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusConfig.dotClass}`} />
            <span>{statusConfig.label}</span>
          </div>
        </div>
      )}

      {/* 状态横幅（若提供） */}
      {statusBanner ? <div className="w-full">{statusBanner}</div> : null}

      {/* 控制筛选区 */}
      {controls ? <div className="w-full">{controls}</div> : null}

      {/* 异动指标网格：支持容器查询 */}
      {anomalies ? (
        <div className="grid grid-cols-2 md:grid-cols-4 @sm:grid-cols-2 @md:grid-cols-4 gap-3 sm:gap-4 min-w-0">
          {anomalies}
        </div>
      ) : null}

      {/* 异常明细区 */}
      {details ? <div className="w-full space-y-4">{details}</div> : null}

      {/* 应急建议与动作区 */}
      {actions ? <div className="space-y-3">{actions}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const MonitoringLayoutDef = defineComponent({
  name: "MonitoringLayout",
  description:
    "监控巡检与告警排查模板：包含健康状态指示、异动指标网格、异常日志/事件明细及应急处置建议，适用于系统稳定性复盘、流量异动告警排查",
  props: z.object({
    title: z.any().optional().describe("巡检/告警主题标题"),
    subtitle: z.any().optional().describe("检测范围或周期说明"),
    status: z
      .any()
      .optional()
      .describe("整体健康状态：normal(正常)、warning(关注/轻微异常)、critical(严重告警)"),
    statusBanner: z.any().optional().describe("顶部状态横幅或核心警报摘要"),
    controls: z.any().optional().describe("控制筛选区：AnalyticsFilterBar 等"),
    anomalies: z.any().optional().describe("异动指标网格：MetricCard 数组"),
    details: z.any().optional().describe("异常明细区：DataTable 或 ActivityTimeline"),
    actions: z.any().optional().describe("应急预案与处置建议：ActionPlanCard 或 ActionButton 数组"),
  }),
  component: ({
    props,
    renderNode,
  }: {
    props?: Record<string, unknown>;
    renderNode?: (node?: unknown) => React.ReactNode;
  }) =>
    renderSafeLayout(
      "MonitoringLayout",
      (zone) => {
        const validStatus = (
          ["normal", "warning", "critical"].includes(String(props?.status))
            ? props?.status
            : "normal"
        ) as "normal" | "warning" | "critical";

        return (
          <MonitoringLayout
            title={props?.title ? String(props.title) : undefined}
            subtitle={props?.subtitle ? String(props.subtitle) : undefined}
            status={validStatus}
            statusBanner={zone(props?.statusBanner, "状态横幅")}
            controls={zone(props?.controls, "控制筛选")}
            anomalies={zone(props?.anomalies, "异动指标")}
            details={zone(props?.details, "异常明细")}
            actions={zone(props?.actions, "应急处置")}
          />
        );
      },
      renderNode
    ),
});
