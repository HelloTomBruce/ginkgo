"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  FileCode,
  FilePlus,
  Terminal,
  Database,
  Package,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import type { ModeEscalationPayload, ModeEscalationChangeItem } from "@ginkgo/app-sdk";

export interface ModeApprovalCardProps {
  payload: ModeEscalationPayload;
  status?: "pending" | "approved" | "rejected";
  onApprove?: (payload: ModeEscalationPayload) => void;
  onReject?: (feedback?: string) => void;
  className?: string;
}

function getChangeTypeBadge(type: ModeEscalationChangeItem["type"]) {
  switch (type) {
    case "file_create":
      return {
        label: "新增文件",
        icon: <FilePlus className="w-3.5 h-3.5 text-success-fg shrink-0" />,
        badgeClass: "bg-success-soft text-success-fg",
      };
    case "file_modify":
      return {
        label: "修改文件",
        icon: <FileCode className="w-3.5 h-3.5 text-info-fg shrink-0" />,
        badgeClass: "bg-info-soft text-info-fg",
      };
    case "dependency_install":
      return {
        label: "依赖安装",
        icon: <Package className="w-3.5 h-3.5 text-warning-fg shrink-0" />,
        badgeClass: "bg-warning-soft text-warning-fg-strong",
      };
    case "command":
      return {
        label: "执行命令",
        icon: <Terminal className="w-3.5 h-3.5 text-brand-fg shrink-0" />,
        badgeClass: "bg-brand-soft text-brand-fg",
      };
    case "database":
      return {
        label: "数据库",
        icon: <Database className="w-3.5 h-3.5 text-brand-fg shrink-0" />,
        badgeClass: "bg-muted text-foreground-strong",
      };
    default:
      return {
        label: "改动",
        icon: <FileCode className="w-3.5 h-3.5 text-foreground-subtle shrink-0" />,
        badgeClass: "bg-muted text-foreground-subtle",
      };
  }
}

export function ModeApprovalCard({
  payload,
  status: propStatus = "pending",
  onApprove,
  onReject,
  className = "",
}: ModeApprovalCardProps) {
  const [localStatus, setLocalStatus] = useState<"pending" | "approved" | "rejected">(propStatus);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isChangesExpanded, setIsChangesExpanded] = useState(true);

  const status = propStatus !== "pending" ? propStatus : localStatus;
  const risk = payload.riskLevel || "medium";

  const riskConfig = {
    low: {
      border: "border-info-border/80",
      bg: "bg-info-soft/30",
      badge: "bg-info-soft-strong text-info-fg-strong",
      badgeLabel: "低风险构建",
      icon: <Info className="w-4 h-4 text-info-fg shrink-0" />,
    },
    medium: {
      border: "border-warning-border/80",
      bg: "bg-warning-soft/30",
      badge: "bg-warning-soft-strong text-warning-fg-strong",
      badgeLabel: "常规构建审批",
      icon: <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0" />,
    },
    high: {
      border: "border-danger-border/80",
      bg: "bg-danger-soft/30",
      badge: "bg-danger-soft-strong text-danger-fg-strong",
      badgeLabel: "高危写操作",
      icon: <ShieldAlert className="w-4 h-4 text-danger-fg shrink-0" />,
    },
  }[risk];

  const handleApprove = () => {
    setLocalStatus("approved");
    onApprove?.(payload);
  };

  const handleReject = () => {
    setLocalStatus("rejected");
    onReject?.(feedback.trim() || undefined);
  };

  // 1. 已批准视图
  if (status === "approved") {
    return (
      <div
        className={`rounded-xl border border-success-border/60 bg-success-soft/25 px-4 py-3 flex items-center justify-between text-xs text-foreground shadow-2xs ${className}`}
      >
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-success-fg shrink-0" />
          <div>
            <span className="font-medium text-foreground-strong">
              已批准切换至构建模式 (Build)
            </span>
            <p className="text-[11px] text-foreground-subtle mt-0.5">
              方案已确认，大模型正在自动执行落地构建流水线...
            </p>
          </div>
        </div>
        <span className="text-[11px] font-sans font-medium text-success-fg bg-success-soft px-2 py-0.5 rounded">
          已授权执行
        </span>
      </div>
    );
  }

  // 2. 已拒绝视图
  if (status === "rejected") {
    return (
      <div
        className={`rounded-xl border border-border bg-surface-sunken/60 px-4 py-3 flex items-center justify-between text-xs text-foreground-subtle shadow-2xs ${className}`}
      >
        <div className="flex items-center gap-2.5">
          <XCircle className="w-4 h-4 text-foreground-subtle shrink-0" />
          <div>
            <span className="font-medium text-foreground-subtle line-through">
              申请切换至构建模式 (Build)
            </span>
            <p className="text-[11px] text-foreground-faint mt-0.5">
              已保持在 Plan 规划模式，大模型将根据您的建议继续推演调整方案
            </p>
          </div>
        </div>
        <span className="text-[11px] font-sans font-medium text-foreground-subtle bg-muted px-2 py-0.5 rounded">
          已保持规划
        </span>
      </div>
    );
  }

  // 3. 待审批视图 (Pending)
  const changes = payload.changes || [];

  return (
    <div
      className={`rounded-xl border ${riskConfig.border} ${riskConfig.bg} p-4 space-y-3.5 text-xs shadow-xs transition-all ${className}`}
    >
      {/* 头部标题与风险徽标 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5">{riskConfig.icon}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground-strong text-sm">
                申请切换至构建模式 (Build)
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-sans font-medium ${riskConfig.badge}`}
              >
                {riskConfig.badgeLabel}
              </span>
            </div>
            <p className="text-xs text-foreground mt-1 leading-relaxed">
              {payload.summary}
            </p>
          </div>
        </div>

        {changes.length > 0 && (
          <button
            type="button"
            onClick={() => setIsChangesExpanded(!isChangesExpanded)}
            className="text-foreground-subtle hover:text-foreground text-[11px] flex items-center gap-1 shrink-0 mt-0.5 cursor-pointer"
          >
            {isChangesExpanded ? (
              <>
                收起变更 ({changes.length}) <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                查看变更 ({changes.length}) <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {/* 拟变更清单列表 */}
      {changes.length > 0 && isChangesExpanded && (
        <div className="space-y-1.5 rounded-lg border border-border/70 bg-card/70 p-2.5">
          <div className="text-[11px] font-medium text-foreground-subtle flex items-center gap-1 mb-1">
            <Sparkles className="w-3 h-3 text-info-fg" />
            <span>本次提权拟执行的改动项：</span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {changes.map((item, idx) => {
              const badge = getChangeTypeBadge(item.type);
              return (
                <div
                  key={`${item.target}-${idx}`}
                  className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-md bg-surface-sunken/60 border border-border/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {badge.icon}
                    <span className="font-mono text-[11px] text-foreground-strong truncate select-all">
                      {item.target}
                    </span>
                    {item.description && (
                      <span className="text-[11px] text-foreground-subtle truncate hidden sm:inline">
                        — {item.description}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-sans shrink-0 ${badge.badgeClass}`}
                  >
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 拒绝与修改反馈输入框 */}
      {showFeedbackInput && (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <div className="flex items-center gap-1.5 text-foreground-subtle text-[11px]">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>告诉大模型为什么保持规划，或输入方案调整要求：</span>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="例如：先不要修改样式，只调整画板结构；或者暂不安装该依赖..."
            rows={2}
            className="w-full text-xs rounded-lg border border-border bg-card p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-brand-border resize-none"
          />
        </div>
      )}

      {/* 底部操作按钮 */}
      <div className="flex items-center justify-end gap-2.5 pt-1">
        {showFeedbackInput ? (
          <>
            <button
              type="button"
              onClick={() => setShowFeedbackInput(false)}
              className="px-2.5 py-1 text-foreground-subtle hover:text-foreground text-xs cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleReject}
              className="px-3.5 py-1.5 rounded-lg bg-foreground-subtle text-background hover:bg-foreground transition-colors font-medium text-xs cursor-pointer"
            >
              保持 Plan 并提交调整建议
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowFeedbackInput(true)}
              className="px-3 py-1.5 rounded-lg border border-border bg-card/90 text-foreground-subtle hover:text-foreground hover:bg-card transition-colors text-xs font-medium cursor-pointer"
            >
              调整方案 / 暂不构建
            </button>
            <button
              type="button"
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground-strong transition-colors text-xs font-semibold shadow-xs cursor-pointer"
            >
              <span>批准并开始构建</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
