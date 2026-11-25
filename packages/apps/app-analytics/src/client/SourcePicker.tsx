"use client";

import React, { useState, useRef, useEffect } from "react";
import { Database, Lock } from "lucide-react";
import { Checkbox } from "./ui/checkbox";

export interface PickerSource {
  id: string;
  name: string;
  enabled: boolean;
}

export interface SourcePickerProps {
  /** 全量数据源列表（含禁用项，组件内部过滤） */
  sources?: PickerSource[];
  /** 当前会话选中的源 id；undefined = 全选 */
  selected?: string[];
  onChange?: (ids: string[]) => void;
  /** 会话开始后锁定：面板只读，仅可查看当前选择 */
  disabled?: boolean;
  className?: string;
  [key: string]: unknown;
}

/**
 * 会话级数据源多选器：勾选集即 session.enabledSources，改动立即写回。
 * 现已支持放置在输入栏底部工具行中，支持外部点击自动收起。
 */
export function SourcePicker({
  sources = [],
  selected,
  onChange = () => {},
  disabled,
  className = "",
}: SourcePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const enabled = sources.filter((s) => s.enabled !== false);
  const enabledIds = enabled.map((s) => s.id);
  const checkedIds = selected ?? enabledIds;
  const checkedCount = enabledIds.filter((id) => checkedIds.includes(id)).length;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggle = (id: string) => {
    if (disabled) return;
    if (checkedIds.includes(id)) {
      onChange(checkedIds.filter((x) => x !== id));
    } else {
      onChange(enabledIds.filter((x) => x === id || checkedIds.includes(x)));
    }
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          disabled
            ? "会话已开始，数据源选择已锁定"
            : "选择当前会话可用的数据源"
        }
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-foreground-subtle hover:text-foreground hover:bg-surface-raised transition-colors cursor-pointer select-none"
      >
        {disabled ? (
          <Lock className="w-3.5 h-3.5 text-foreground-faint shrink-0" />
        ) : (
          <Database className="w-3.5 h-3.5 text-info-fg shrink-0" />
        )}
        <span className="font-medium truncate max-w-[120px] sm:max-w-[160px]">
          数据源 {checkedCount}/{enabledIds.length}
        </span>
      </button>

      {open && (
        <div
          role="group"
          aria-label="数据源选择"
          className="absolute left-0 bottom-full mb-2 z-50 bg-card border border-border rounded-xl shadow-xl p-2 w-72 space-y-0.5 animate-in fade-in-0"
        >
          {disabled && (
            <div className="text-[10px] text-foreground-faint flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle mb-1">
              <Lock className="w-3 h-3" />
              <span>会话已开始，数据源选择已锁定</span>
            </div>
          )}
          {enabled.length === 0 && (
            <div className="text-[11px] text-foreground-faint px-2 py-1.5">
              暂无可用数据源，请在「设置 → 数据源」中启用
            </div>
          )}
          {enabled.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 text-xs text-foreground-subtle cursor-pointer px-2 py-1.5 rounded-lg hover:bg-surface-sunken"
            >
              {/* button 属于 labelable 元素：点击行文本由 label 激活行为转发一次 click，
                  点击 checkbox 本体浏览器不再转发（target 已是控件）——两条路径均恰好 toggle 一次。
                  切勿再给行加 onClick：会与 label 转发叠加成双切换（取消又勾回） */}
              <Checkbox
                checked={checkedIds.includes(s.id)}
                onCheckedChange={() => toggle(s.id)}
                disabled={disabled}
                aria-label={s.name}
              />
              <span
                className={`truncate flex-1 ${
                  disabled ? "cursor-not-allowed text-foreground-faint" : ""
                }`}
              >
                {s.name}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
