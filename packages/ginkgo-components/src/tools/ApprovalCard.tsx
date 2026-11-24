"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface ApprovalCardProps {
  /** 审批动作标题 */
  title: string;
  /** 描述说明或影响评估 */
  description?: string;
  /** 风险级别：决定视觉颜色 */
  riskLevel?: "info" | "warning" | "danger";
  /** 当前审批状态 */
  status?: "pending" | "approved" | "rejected";
  /** 批准回调 */
  onApprove?: () => void;
  /** 拒绝回调，可选携带反馈内容 */
  onReject?: (feedback?: string) => void;
  /** 拒绝理由占位文案 */
  rejectFeedbackPlaceholder?: string;
  /** 内部载荷（如待执行命令或代码 Diff） */
  children?: React.ReactNode;
  className?: string;
}

export function ApprovalCard({
  title,
  description,
  riskLevel = "warning",
  status = "pending",
  onApprove,
  onReject,
  rejectFeedbackPlaceholder = "告诉大模型为什么拒绝，或提出具体的修改建议...",
  children,
  className = "",
}: ApprovalCardProps) {
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPayloadExpanded, setIsPayloadExpanded] = useState(true);

  const riskStyles = {
    info: {
      border: "border-info-border",
      bg: "bg-info-soft/40",
      badge: "bg-info-soft-strong text-info-fg-strong",
      icon: <Info className="w-4 h-4 text-info-fg shrink-0" />,
      badgeLabel: "信息确认",
    },
    warning: {
      border: "border-warning-border",
      bg: "bg-warning-soft/40",
      badge: "bg-warning-soft-strong text-warning-fg-strong",
      icon: <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0" />,
      badgeLabel: "操作审批",
    },
    danger: {
      border: "border-danger-border",
      bg: "bg-danger-soft/40",
      badge: "bg-danger-soft-strong text-danger-fg-strong",
      icon: <ShieldAlert className="w-4 h-4 text-danger-fg shrink-0" />,
      badgeLabel: "高危审批",
    },
  }[riskLevel];

  // 1. 已批准状态视图
  if (status === "approved") {
    return (
      <div
        className={`rounded-xl border border-success-border/60 bg-success-soft/30 px-3.5 py-2.5 flex items-center justify-between text-xs text-foreground ${className}`}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-success-fg shrink-0" />
          <span className="font-medium text-foreground-strong">{title}</span>
          <span className="text-[11px] text-foreground-subtle">已被人工批准执行</span>
        </div>
        <span className="text-[11px] font-sans font-medium text-success-fg bg-success-soft px-2 py-0.5 rounded">
          已批准
        </span>
      </div>
    );
  }

  // 2. 已拒绝状态视图
  if (status === "rejected") {
    return (
      <div
        className={`rounded-xl border border-border bg-surface-sunken/60 px-3.5 py-2.5 flex items-center justify-between text-xs text-foreground-subtle ${className}`}
      >
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-danger-fg shrink-0" />
          <span className="font-medium line-through text-foreground-subtle">{title}</span>
          <span className="text-[11px]">操作已拒绝，大模型将调整策略</span>
        </div>
        <span className="text-[11px] font-sans font-medium text-danger-fg bg-danger-soft px-2 py-0.5 rounded">
          已拒绝
        </span>
      </div>
    );
  }

  // 3. 待审批状态视图 (Pending)
  return (
    <div
      className={`rounded-xl border ${riskStyles.border} ${riskStyles.bg} p-3.5 space-y-3 text-xs shadow-xs transition-all ${className}`}
    >
      {/* 头部信息 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {riskStyles.icon}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground-strong">{title}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-sans font-medium ${riskStyles.badge}`}
              >
                {riskStyles.badgeLabel}
              </span>
            </div>
            {description && (
              <p className="text-[11px] text-foreground-subtle mt-0.5">{description}</p>
            )}
          </div>
        </div>

        {children && (
          <button
            type="button"
            onClick={() => setIsPayloadExpanded(!isPayloadExpanded)}
            className="text-foreground-subtle hover:text-foreground text-[11px] flex items-center gap-0.5 shrink-0"
          >
            {isPayloadExpanded ? (
              <>
                收起详情 <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                查看详情 <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {/* 载荷区域（命令展示或代码 Diff） */}
      {children && isPayloadExpanded && (
        <div className="rounded-lg overflow-hidden border border-border/80">{children}</div>
      )}

      {/* 拒绝反馈输入区域 */}
      {showFeedbackInput && (
        <div className="space-y-2 pt-1 border-t border-border/60">
          <div className="flex items-center gap-1.5 text-foreground-subtle text-[11px]">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>输入拒绝原因或替代建议（可选）：</span>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={rejectFeedbackPlaceholder}
            rows={2}
            className="w-full text-xs rounded-lg border border-border bg-card p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-brand-border resize-none"
          />
        </div>
      )}

      {/* 底部按钮操作栏 */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {showFeedbackInput ? (
          <>
            <button
              type="button"
              onClick={() => setShowFeedbackInput(false)}
              className="px-2.5 py-1 text-foreground-subtle hover:text-foreground text-xs"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onReject?.(feedback.trim() || undefined)}
              className="px-3 py-1 rounded-md bg-danger-soft-strong text-danger-fg-strong hover:bg-danger-soft transition-colors font-medium text-xs"
            >
              确认拒绝并回传
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowFeedbackInput(true)}
              className="px-3 py-1 rounded-md border border-border bg-card/80 text-foreground-subtle hover:text-foreground hover:bg-card transition-colors text-xs font-medium"
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => onApprove?.()}
              className="px-3.5 py-1 rounded-md bg-brand-solid text-brand-solid-fg hover:opacity-90 transition-opacity text-xs font-semibold shadow-xs"
            >
              批准执行
            </button>
          </>
        )}
      </div>
    </div>
  );
}
