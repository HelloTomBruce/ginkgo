"use client";

import React, { useState } from "react";
import {
  Pin,
  X,
  Maximize2,
  Minimize2,
  Printer,
  Layers,
} from "lucide-react";
import { UiSpecRenderer, DashboardScopeProvider } from "@ginkgolab/components";
import type { AppWorkspaceProps } from "@ginkgolab/app-sdk";
import { Hint } from "./ui/hint";

export interface CanvasDashboardData {
  id: string;
  title?: string;
  dsl: string;
  isLive?: boolean;
}

/**
 * 数据分析画布工作台 Props：
 * 直接复用平台插槽契约 AppWorkspaceProps（组合根以 AppWorkspaceProps 注入，
 * 自定义较窄签名会造成契约漂移），不再本地重复声明同名字段。
 */
export type AnalysisCanvasProps = AppWorkspaceProps;

export function AnalysisCanvas({
  data: rawData,
  onClose,
  onAction,
  onPrint,
  isExpanded: controlledExpanded,
  onToggleExpand,
}: AnalysisCanvasProps) {
  const data = rawData as CanvasDashboardData | null;
  const [internalExpanded, setInternalExpanded] = useState(false);

  const isExpanded =
    controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded((v) => !v);
    }
  };

  return (
    <aside
      aria-label="分析画布"
      className={`flex flex-col border-l border-border bg-card transition-all duration-300 overflow-hidden shrink-0 ${
        isExpanded && controlledExpanded === undefined
          ? "fixed inset-0 z-50 bg-card/95 backdrop-blur-md"
          : "h-full w-full"
      }`}
    >
      {/* 画布顶部工具栏 */}
      <header className="h-14 border-b border-border px-5 flex items-center justify-between shrink-0 bg-surface-sunken/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-info-soft border border-info-border flex items-center justify-center text-info-fg shrink-0">
            <Pin className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-foreground truncate max-w-[200px] sm:max-w-xs">
              {data?.title || "分析画布 (Analysis Canvas)"}
            </h3>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              {data?.isLive ? "活看板 · 零 LLM 联动" : "协同分析视图"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {data && onPrint && (
            <Hint label="打印 / 导出 PDF">
              <button
                type="button"
                onClick={() => onPrint(data.id)}
                aria-label="导出 PDF"
                className="p-1.5 text-foreground-subtle hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
              </button>
            </Hint>
          )}

          <Hint label={isExpanded ? "还原分栏" : "放大至全屏"}>
            <button
              type="button"
              onClick={handleToggleExpand}
              aria-label={isExpanded ? "还原" : "全屏"}
              className="p-1.5 text-foreground-subtle hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              {isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </Hint>

          <Hint label="收起画布">
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭画布"
              className="p-1.5 text-foreground-subtle hover:text-foreground rounded-lg hover:bg-muted transition-colors ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Hint>
        </div>
      </header>

      {/* 画布内容区 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-w-0">
        {!data ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground select-none">
            <div className="w-12 h-12 rounded-2xl bg-surface-raised border border-border flex items-center justify-center mb-3">
              <Layers className="w-6 h-6 text-foreground-faint" />
            </div>
            <p className="text-sm font-medium text-foreground">分析画布已就绪</p>
            <p className="text-xs text-foreground-faint mt-1 max-w-xs leading-relaxed">
              点击左侧对话中生成的看板「钉选到画布」按钮，或在侧边栏点击收藏看板，即可在此常驻协同分析。
            </p>
          </div>
        ) : (
          <DashboardScopeProvider scopeId={data.id}>
            <div className="max-w-5xl mx-auto space-y-4">
              <UiSpecRenderer
                content={data.dsl}
                isStreaming={false}
                onAction={onAction}
              />
            </div>
          </DashboardScopeProvider>
        )}
      </div>
    </aside>
  );
}
