"use client";

import React, { useState, useRef, useEffect } from "react";
import { Sparkles, ChevronDown, Check } from "lucide-react";
import { isReasoningModel, type ReasoningEffort } from "@/lib/llmProviders";

export interface ReasoningEffortSwitcherProps {
  model: string;
  supportsReasoning?: boolean;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  placement?: "top" | "bottom";
  className?: string;
}

const EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "low",
    label: "Low (低)",
    shortLabel: "低",
    description: "快速响应 · 适合简单问答与轻量任务",
  },
  {
    value: "medium",
    label: "Medium (中)",
    shortLabel: "中",
    description: "平衡推荐 · 深度思考与响应速度兼顾",
  },
  {
    value: "high",
    label: "High (高)",
    shortLabel: "高",
    description: "深度穷举 · 适合跨表分析、复杂 SQL 与推演",
  },
];

export function ReasoningEffortSwitcher({
  model,
  supportsReasoning,
  reasoningEffort,
  onReasoningEffortChange,
  placement = "top",
  className = "",
}: ReasoningEffortSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 监听外部点击与 Escape 关闭弹层
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // 非推理思考模型不展示：优先遵循显式配置 supportsReasoning，否则基于模型名称智能推断
  const isReasoning =
    typeof supportsReasoning === "boolean"
      ? supportsReasoning
      : isReasoningModel(model);

  if (!isReasoning) {
    return null;
  }

  const currentOption =
    EFFORT_OPTIONS.find((opt) => opt.value === reasoningEffort) ||
    EFFORT_OPTIONS[1];

  return (
    <div ref={containerRef} className={`relative inline-block shrink-0 ${className}`}>
      {/* 触发按钮：与 ModelSwitcher 紧邻 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`推理等级：当前 ${currentOption.label}`}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-brand-fg bg-brand-soft hover:bg-brand-soft-strong transition-colors cursor-pointer select-none border border-brand-soft-strong shrink-0"
      >
        <Sparkles className="w-3.5 h-3.5 text-brand-fg shrink-0" />
        <span>思考: {currentOption.shortLabel}</span>
        <ChevronDown
          className={`w-3 h-3 text-brand-fg opacity-70 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* 下拉/上浮弹层 */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute z-50 w-60 rounded-xl border border-border bg-card shadow-xl p-1.5 text-xs text-foreground animate-in fade-in-0 ${
            placement === "top"
              ? "bottom-full mb-2 left-0 slide-in-from-bottom-2"
              : "top-full mt-1.5 left-0 zoom-in-95"
          }`}
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-foreground-faint uppercase tracking-wider flex items-center justify-between border-b border-border-subtle pb-1.5 mb-1">
            <span className="flex items-center gap-1 text-brand-fg">
              <Sparkles className="w-3 h-3" />
              <span>思考预算（Reasoning Effort）</span>
            </span>
          </div>
          <div className="space-y-0.5">
            {EFFORT_OPTIONS.map((opt) => {
              const isSelected = opt.value === reasoningEffort;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onReasoningEffortChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-brand-soft text-brand-fg font-medium"
                      : "text-foreground-subtle hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span>{opt.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-brand-fg" />}
                    </div>
                    <div className="text-[10px] text-foreground-faint mt-0.5">
                      {opt.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
