"use client";

import React from "react";
import { Send, Sparkles, Hammer, Square } from "lucide-react";
import { Hint } from "@/components/ui/hint";

export type InteractionMode = "plan" | "build";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  /** 通用交互模式（Plan 方案规划 / Build 直接构建）；兼容向后 planMode 布尔值 */
  mode?: InteractionMode;
  planMode?: boolean;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onModeChange?: (mode: InteractionMode) => void;
  onPlanModeChange?: (next: boolean) => void;
  /** 中止/暂停当前生成 */
  onStop?: () => void;
  /** 可选注入模型选择器控件 */
  modelSwitcherNode?: React.ReactNode;
  /** 可选注入推理等级选择器控件（当选中深度思考模型时展示） */
  reasoningEffortNode?: React.ReactNode;
  /** 可选注入数据源选择器控件 */
  sourcePickerNode?: React.ReactNode;
  /** 可选注入上下文用量指示器 */
  contextUsageNode?: React.ReactNode;
}

/** 自适应高度上限：约 6 行（24px 行高 + 余量），超出后内滚 */
const TEXTAREA_MAX_HEIGHT = 160;

export function ChatInput({
  input,
  isLoading,
  mode,
  planMode = true,
  onChange,
  onSubmit,
  onModeChange,
  onPlanModeChange,
  onStop,
  modelSwitcherNode,
  reasoningEffortNode,
  sourcePickerNode,
  contextUsageNode,
}: ChatInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const currentMode: InteractionMode = mode ?? (planMode ? "plan" : "build");
  const isPlan = currentMode === "plan";

  const handleToggleMode = (targetMode?: InteractionMode) => {
    const nextMode = targetMode ?? (isPlan ? "build" : "plan");
    onModeChange?.(nextMode);
    onPlanModeChange?.(nextMode === "plan");
  };

  // 受控值变化（输入/清空/预设带入）后重算高度：先归零再取 scrollHeight 才会收缩
  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, []);

  React.useEffect(() => {
    resize();
  }, [input, resize]);

  // Enter 发送 / Shift+Enter 换行；中文输入法组词期间的 Enter（isComposing）不触发发送
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      !isLoading &&
      input.trim()
    ) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="no-print p-4 bg-card border-t border-border">
      <form onSubmit={onSubmit} className="max-w-4xl mx-auto">
        {/* 输入框容器：边框/聚焦环在容器上，内部为 textarea + 底部工具行 */}
        <div className="bg-surface-sunken border border-border rounded-2xl focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isLoading
                ? "AI 正在流式推理并执行操作..."
                : isPlan
                  ? "Plan 模式（先出思路模式）：AI 将先梳理方案与关键确认点，确认后再执行构建...（Enter 发送，Shift+Enter 换行）"
                  : "Build 模式：直接执行任务并输出最终交付产物...（Enter 发送，Shift+Enter 换行）"
            }
            disabled={isLoading}
            className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 placeholder:text-foreground-faint focus:outline-none resize-none disabled:opacity-50 overflow-y-auto"
            style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
          />
          {/* 底部工具行：左侧「Plan / Build 模式切换」+ 模型切换 + 数据源切换 + 上下文进度，右发送按钮 */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1 gap-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {/* Plan / Build 模式选择器 */}
              <div
                className="flex items-center p-0.5 bg-surface-sunken border border-border/80 rounded-lg text-xs"
                role="group"
                aria-label="模式切换"
              >
                <Hint label="Plan 模式（先出思路）：先给出方案与关键决策点，确认后再执行构建">
                  <button
                    type="button"
                    aria-label="Plan (先出思路)"
                    aria-pressed={isPlan}
                    onClick={() => handleToggleMode(isPlan ? "build" : "plan")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer select-none ${
                      isPlan
                        ? "bg-card text-info-fg shadow-2xs font-semibold"
                        : "text-foreground-faint hover:text-foreground-subtle"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Plan</span>
                  </button>
                </Hint>
                <Hint label="Build 模式（直接构建）：跳过前期方案确认，直接执行并交付最终产物">
                  <button
                    type="button"
                    aria-label="Build (直接构建)"
                    aria-pressed={!isPlan}
                    onClick={() => handleToggleMode(isPlan ? "build" : "plan")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer select-none ${
                      !isPlan
                        ? "bg-card text-foreground shadow-2xs font-semibold"
                        : "text-foreground-faint hover:text-foreground-subtle"
                    }`}
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    <span>Build</span>
                  </button>
                </Hint>
              </div>

              {modelSwitcherNode}
              {reasoningEffortNode}
              {sourcePickerNode}
              {contextUsageNode}
            </div>
            <div className="shrink-0">
              {isLoading ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="停止生成"
                  className="bg-danger-solid hover:bg-danger-solid-hover text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer select-none"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>停止</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="bg-info-solid hover:bg-info-solid-hover text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs"
                >
                  <Send className="w-4 h-4" />
                  <span>发送</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
