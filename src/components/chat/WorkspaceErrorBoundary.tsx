"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 工作台插槽专属错误边界（Slot Error Boundary）
 * 隔离应用自治前端组件的运行时崩溃，保证宿主主对话流绝对不中断。
 */
export class WorkspaceErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[WorkspaceErrorBoundary] 插槽组件崩溃捕获:", error, errorInfo);
  }

  public handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-card rounded-xl border border-border">
          <div className="w-10 h-10 rounded-full bg-danger-soft text-danger-fg flex items-center justify-center mb-3">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {this.props.fallbackTitle || "工作台组件渲染异常"}
          </h3>
          <p className="text-xs text-foreground-subtle max-w-sm mb-4 leading-relaxed font-mono">
            {this.state.error?.message || "应用工作台插槽发生未捕获异常"}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>重试加载工作台</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
