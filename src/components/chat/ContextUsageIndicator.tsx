"use client";

import React from "react";
import { Hint } from "@/components/ui/hint";

export interface ContextUsageIndicatorProps {
  promptTokens: number;
  window: number;
  className?: string;
}

/**
 * 环形上下文用量指示器：
 * - 紧凑展示环形进度条与已使用百分比
 * - 悬停时通过 Hint 弹出展示详细 Token 占用量与总窗口上限
 * - 包含无障碍辅助节点，确保语义与测试稳定性
 */
export function ContextUsageIndicator({
  promptTokens,
  window: contextWindow,
  className = "",
}: ContextUsageIndicatorProps) {
  const windowSize = contextWindow > 0 ? contextWindow : 1;
  const ratio = promptTokens / windowSize;
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const percentage = Math.round(clampedRatio * 100);

  // 环形半径与周长 (r=7, C=2*PI*7 ≈ 43.982)
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clampedRatio);

  // 状态颜色：>90% 危险红，>70% 警告黄，正常为成功绿
  const colorClass =
    ratio > 0.9
      ? "text-danger-solid"
      : ratio > 0.7
      ? "text-warning-solid"
      : "text-success-solid";

  const promptK = (promptTokens / 1000).toFixed(1);
  const windowK = Math.round(windowSize / 1000);
  const detailText = `${promptK}k / ${windowK}k（${percentage}%）`;
  const tooltipLabel = `上下文用量：${detailText}（已用 ${promptTokens.toLocaleString()} / 上限 ${windowSize.toLocaleString()} tokens）`;

  return (
    <Hint label={tooltipLabel} side="top">
      <div
        tabIndex={0}
        role="status"
        aria-label={`上下文用量：${detailText}`}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-foreground-subtle hover:text-foreground hover:bg-surface-raised transition-colors cursor-pointer select-none ${className}`}
      >
        <svg
          className="w-3.5 h-3.5 -rotate-90 shrink-0"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <circle
            cx="10"
            cy="10"
            r={radius}
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            className="text-border"
          />
          <circle
            cx="10"
            cy="10"
            r={radius}
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`transition-all duration-300 ${colorClass}`}
          />
        </svg>
        <span className="font-medium tabular-nums text-foreground-subtle">
          {percentage}%
        </span>
        {/* 屏幕阅读器与兼容断言文本 */}
        <span className="sr-only">上下文</span>
        <span className="sr-only">{detailText}</span>
      </div>
    </Hint>
  );
}
