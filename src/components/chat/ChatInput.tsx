"use client";

import React from "react";
import { Send, ClipboardList, Square } from "lucide-react";
import { Hint } from "@/components/ui/hint";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  /** Plan-first：新问题先出分析思路供确认（默认关） */
  planMode: boolean;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onPlanModeChange: (next: boolean) => void;
  /** 中止/暂停当前生成 */
  onStop?: () => void;
  /** 可选注入模型选择器控件 */
  modelSwitcherNode?: React.ReactNode;
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
  planMode,
  onChange,
  onSubmit,
  onPlanModeChange,
  onStop,
  modelSwitcherNode,
  sourcePickerNode,
  contextUsageNode,
}: ChatInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

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
                ? "Vercel AI SDK 正在流式推理并调用 MCP 查询..."
                : planMode
                  ? "先出思路模式：AI 将先探查数据结构并给出分析思路与澄清问题，确认后再产出看板...（Enter 发送，Shift+Enter 换行）"
                  : "例如：从数据库分析各渠道 CAC，输出响应式预算试算器与落地行动建议...（Enter 发送，Shift+Enter 换行）"
            }
            disabled={isLoading}
            className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 placeholder:text-foreground-faint focus:outline-none resize-none disabled:opacity-50 overflow-y-auto"
            style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
          />
          {/* 底部工具行：左侧「先出思路」+ 模型切换 + 数据源切换 + 上下文进度，右发送按钮 */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1 gap-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <Hint label="开启后，新问题将先探查数据结构并给出分析思路与澄清问题，确认方向后再产出看板">
                <button
                  type="button"
                  aria-pressed={planMode}
                  onClick={() => onPlanModeChange(!planMode)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors select-none cursor-pointer shrink-0 ${
                    planMode
                      ? "bg-info-soft-strong text-info-fg-strong"
                      : "text-foreground-faint hover:text-foreground-subtle"
                  }`}
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>先出思路</span>
                </button>
              </Hint>
              {modelSwitcherNode}
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
