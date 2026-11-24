"use client";

import React, { useState } from "react";
import { Terminal, Copy, Check, ChevronDown, ChevronRight, Play } from "lucide-react";

export interface TerminalViewerProps {
  /** 执行的 Shell 命令行 */
  command: string;
  /** 终端输出内容（stdout / stderr） */
  output?: string;
  /** 退出状态码（0 代表成功，非 0 失败） */
  exitCode?: number;
  /** 耗时毫秒数 */
  durationMs?: number;
  /** 是否正在执行中 */
  isRunning?: boolean;
  /** 初始是否展开输出 */
  defaultOpen?: boolean;
  className?: string;
}

export function TerminalViewer({
  command,
  output,
  exitCode,
  durationMs,
  isRunning = false,
  defaultOpen = false,
  className = "",
}: TerminalViewerProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const hasOutput = typeof output === "string" && output.length > 0;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const fullText = `$ ${command}\n${output || ""}`;
    void navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`rounded-xl border border-border bg-surface-sunken overflow-hidden text-xs font-mono shadow-xs transition-all ${className}`}
    >
      {/* 头部控制栏 */}
      <div
        onClick={() => hasOutput && setIsOpen(!isOpen)}
        className={`flex items-center justify-between px-3.5 py-2 bg-card/60 border-b border-border select-none transition-colors ${
          hasOutput ? "cursor-pointer hover:bg-card" : ""
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasOutput ? (
            <button
              type="button"
              className="p-0.5 text-foreground-subtle hover:text-foreground transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <Terminal className="w-3.5 h-3.5 text-foreground-subtle shrink-0" />
          )}

          <div className="flex items-center gap-1.5 truncate">
            <span className="text-brand-fg font-bold select-none">$</span>
            <span className="font-semibold text-foreground-strong truncate">{command}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-sans">
          {durationMs !== undefined && (
            <span className="text-[10px] text-foreground-subtle">{durationMs}ms</span>
          )}

          {isRunning ? (
            <span className="text-[10px] bg-info-soft text-info-fg px-1.5 py-0.5 rounded font-medium animate-pulse flex items-center gap-1">
              <Play className="w-2.5 h-2.5 fill-current" />
              运行中...
            </span>
          ) : exitCode !== undefined ? (
            exitCode === 0 ? (
              <span className="text-[10px] bg-success-soft text-success-fg px-1.5 py-0.5 rounded font-medium">
                成功
              </span>
            ) : (
              <span className="text-[10px] bg-danger-soft text-danger-fg px-1.5 py-0.5 rounded font-medium">
                退出码 {exitCode}
              </span>
            )
          ) : null}

          <button
            type="button"
            onClick={handleCopy}
            title="复制命令行与输出"
            className="p-1 rounded-md text-foreground-subtle hover:text-foreground hover:bg-card transition-colors ml-1"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success-fg" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* 输出内容面板 */}
      {isOpen && hasOutput && (
        <div className="p-3 bg-surface-sunken max-h-[320px] overflow-y-auto whitespace-pre-wrap font-mono text-foreground-subtle text-[11px] leading-relaxed select-text border-t border-border/40">
          {output}
        </div>
      )}
    </div>
  );
}
