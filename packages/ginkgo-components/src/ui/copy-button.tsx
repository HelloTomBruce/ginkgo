"use client";

/**
 * 复制按钮 UI 原语：点击复制文本，成功后短暂切换为「已复制」反馈。
 * stopPropagation 防止嵌套在可点击容器（如折叠卡片头部）时触发父级交互。
 * variant="compact"：图标 + 文本标签（详情面板内）；variant="icon"：纯图标（工具栏）。
 */
import React, { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

export interface CopyButtonProps {
  /** 待复制文本（空串时按钮不渲染） */
  text: string;
  /** 无障碍标签与按钮文案（icon 变体仅作 aria-label） */
  label?: string;
  /** 纯图标工具栏变体（缺省 compact 图标+文本） */
  variant?: "compact" | "icon";
}

export function CopyButton({ text, label = "复制", variant = "compact" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!text || !navigator?.clipboard) return;
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [text]
  );

  if (!text) return null;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
        title={label}
        aria-label={label}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success-fg" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-foreground-subtle hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-surface-raised select-none"
      title={label}
      aria-label={label}
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-success-fg" />
          <span className="text-[10px] text-success-fg font-sans font-medium">已复制</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span className="text-[10px] font-sans">{label}</span>
        </>
      )}
    </button>
  );
}
