"use client";

import React, { useRef } from "react";
import { Renderer } from "@openuidev/react-lang";
import { analyticsLibrary, ErrorBoundary } from "./index";
import { Activity, CheckCircle2, Loader2 } from "lucide-react";

/** 客户端本地工具集合类型（如宿主的 clientTools） */
export type OpenUIToolMap = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

/**
 * 工具提供者上下文：宿主在应用根部挂载一次，所有 OpenUIRenderer 实例
 * （含应用包插槽组件内的渲染）自动获得客户端本地工具，无需逐层透传。
 */
const OpenUIToolProviderContext = React.createContext<OpenUIToolMap | null>(null);

export function OpenUIToolProvider({
  tools,
  children,
}: {
  tools: OpenUIToolMap;
  children: React.ReactNode;
}) {
  return (
    <OpenUIToolProviderContext.Provider value={tools}>
      {children}
    </OpenUIToolProviderContext.Provider>
  );
}

interface OpenUIRendererProps {
  content: string;
  isStreaming?: boolean;
  onAction?: (actionPrompt: string) => void;
  showObservabilityBadge?: boolean;
  /** 覆盖上下文的工具集合（缺省取 OpenUIToolProviderContext） */
  toolProvider?: OpenUIToolMap;
}

/**
 * 流式内容平滑节流：在流式生成期间将超高频 AST 重解析降频到最高 ~8fps（约 120ms 一次），
 * 彻底释放主线程 CPU，防止包含多图表的复杂报表在流式解析期导致整个页面卡死。
 * 流式结束时（isStreaming=false）立即同步 100% 最新内容。
 */
function useStreamingThrottled(content: string, isStreaming: boolean, intervalMs = 120): string {
  const [throttled, setThrottled] = React.useState(content);
  const contentRef = React.useRef(content);
  const lastUpdateRef = React.useRef(0);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    contentRef.current = content;
    if (!isStreaming) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= intervalMs) {
      setThrottled(contentRef.current);
      lastUpdateRef.current = now;
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        setThrottled(contentRef.current);
        lastUpdateRef.current = Date.now();
        timerRef.current = null;
      }, intervalMs - elapsed);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [content, isStreaming, intervalMs]);

  // 非流式状态下直接呈现最新内容，零副作用；流式状态下使用节流后的 AST 内容
  return isStreaming ? throttled : content;
}

/**
 * OpenUI 官方声明式组件视觉渲染器（平台渲染引擎，应用包可直接复用）
 * 集成：
 * 1. Client-Side ToolProvider (客户端本地工具，经 OpenUIToolProviderContext 或 prop 注入)
 * 2. Observability Metrics (静态只读指标，零状态副作用)
 * 3. 流式渐进式 Loading 指示条
 * 4. Error Boundary (全链路安全边界)
 */
export const OpenUIRenderer: React.FC<OpenUIRendererProps> = React.memo(function OpenUIRenderer({
  content,
  isStreaming = false,
  onAction,
  showObservabilityBadge = true,
  toolProvider,
}) {
  const renderContent = useStreamingThrottled(content, isStreaming);
  const onActionRef = useRef(onAction);
  React.useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const contextTools = React.useContext(OpenUIToolProviderContext);
  const tools = toolProvider ?? contextTools ?? undefined;

  const handleAction = React.useCallback((event: unknown) => {
    const handler = onActionRef.current;
    if (handler) {
      const ev = event as { humanFriendlyMessage?: string; userMessage?: string } | string | undefined;
      let message = "";
      if (typeof ev === "string") {
        message = ev;
      } else if (ev && typeof ev === "object") {
        message = ev.humanFriendlyMessage || ev.userMessage || JSON.stringify(ev);
      }
      if (message) {
        handler(message);
      }
    }
  }, []);

  const handleError = React.useCallback((errors: unknown) => {
    if (errors && Array.isArray(errors) && errors.length > 0) {
      console.warn("[OpenUI Lang Parser/Render Notice]:", errors);
    }
  }, []);

  if (!renderContent || !renderContent.trim()) return null;

  return (
    // resetKey=renderContent：流式中间态解析失败后，新 token 到达时自动复位重试
    <ErrorBoundary name="OpenUIRenderer" resetKey={renderContent}>
      <div className="w-full space-y-3 animate-surface-appear">
        {/* 流式生成进行中的 Loading 状态条 */}
        {isStreaming && (
          <div className="flex items-center justify-between px-3 py-2 bg-surface-sunken border border-border rounded-lg text-xs text-foreground-subtle">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground-faint" />
              <span className="font-medium">正在流式渲染可视化组件与计算图表...</span>
            </div>
            <span className="text-[10px] bg-surface-raised text-foreground-faint px-2 py-0.5 rounded-full font-mono">
              Live Streaming
            </span>
          </div>
        )}

        <Renderer
          library={analyticsLibrary}
          response={renderContent}
          isStreaming={isStreaming}
          toolProvider={tools}
          publishObservability={false}
          onError={handleError}
          onAction={handleAction}
        />

        {/* 流式完成后的只读指标展示 (纯静态计算，无 setState 副作用) */}
        {showObservabilityBadge && !isStreaming && (
          <div className="pt-2 flex items-center justify-between text-[10px] text-foreground-faint font-mono border-t border-border-subtle">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-success-fg" />
              <span>AST 字符: {content.length}</span>
              <span>•</span>
              <span>Visual Components: Active</span>
            </div>
            <div className="flex items-center gap-1 text-success-fg">
              <CheckCircle2 className="w-3 h-3" />
              <span>Client Tools Ready</span>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
});
