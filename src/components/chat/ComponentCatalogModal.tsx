"use client";

import React, { useState } from "react";
import { LayoutGrid, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Renderer } from "@openuidev/react-lang";
import {
  componentCatalog,
  componentDemos,
  analyticsLibrary,
  ErrorBoundary,
  type ComponentCatalogEntry,
} from "@openui-analytics/components";

interface ComponentCatalogModalProps {
  open: boolean;
  onClose: () => void;
}

/** 目录全量条目（拍平，供选中查找） */
const FLAT_ENTRIES: readonly ComponentCatalogEntry[] = componentCatalog.flatMap(
  (g) => g.components
);

/** 默认选中第一个带演示的组件（开窗即有实况预览） */
const DEFAULT_SELECTED =
  FLAT_ENTRIES.find((e) => componentDemos[e.name])?.name ?? FLAT_ENTRIES[0].name;

/**
 * 可视化组件查看入口（主从布局）：左侧分类组件列表，右侧详情区
 * 按原始尺寸实况预览（经 <Renderer/> 生产路径渲染，可滚动查看完整内容），
 * 点击左侧条目切换。目录数据来自 componentCatalog（与 analyticsLibrary 同源）。
 */
export function ComponentCatalogModal({ open, onClose }: ComponentCatalogModalProps) {
  const total = FLAT_ENTRIES.length;
  const [selectedName, setSelectedName] = useState(DEFAULT_SELECTED);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const selected = FLAT_ENTRIES.find((e) => e.name === selectedName) ?? FLAT_ENTRIES[0];
  const demoDsl = componentDemos[selected.name];

  const toggleGroup = (category: string) =>
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[calc(100%-2rem)] sm:max-w-4xl max-h-[85vh] w-full p-0 gap-0 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
      >
        <DialogTitle className="sr-only">可视化组件</DialogTitle>

        {/* 头部 */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-info-solid flex items-center justify-center text-white shrink-0">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-sm">可视化组件</h2>
            <p className="text-[11px] text-foreground-faint">
              分析结果中的图表与卡片由下列组件渲染，点击查看实况预览
            </p>
          </div>
          <div className="text-[11px] text-foreground-faint shrink-0 text-right leading-relaxed">
            {componentCatalog.length} 个分类 · {total} 个组件
          </div>
        </div>

        {/* 主从内容区：窄屏上下堆叠，sm 起左右分栏 */}
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          {/* 左栏：分类分组组件列表（分类头可折叠） */}
          <nav className="sm:w-52 shrink-0 overflow-y-auto border-b sm:border-b-0 sm:border-r border-border p-3 space-y-3 max-h-40 sm:max-h-none">
            {componentCatalog.map((group) => {
              const isCollapsed = collapsed[group.category];
              return (
                <div key={group.category}>
                  <button
                    onClick={() => toggleGroup(group.category)}
                    aria-expanded={!isCollapsed}
                    className="w-full flex items-center justify-between gap-1 px-1 mb-1 text-[10px] font-semibold text-foreground-faint uppercase tracking-wide hover:text-foreground-subtle transition-colors"
                  >
                    <span>{group.category}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="font-mono normal-case">{group.components.length}</span>
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      />
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {group.components.map((entry) => {
                        const active = entry.name === selected.name;
                        return (
                          <button
                            key={entry.name}
                            onClick={() => setSelectedName(entry.name)}
                            aria-pressed={active}
                            className={`w-full text-left text-[11px] font-mono px-2 py-1.5 rounded-lg truncate transition-colors ${
                              active
                                ? "bg-info-soft text-info-fg font-semibold"
                                : "text-foreground-subtle hover:bg-muted"
                            }`}
                          >
                            {entry.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* 右栏：详情 + 原尺寸实况预览（可滚动） */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-3 border-b border-border-subtle space-y-1.5 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-foreground-subtle">
                  {selected.name}
                </span>
              </div>
              {selected.description && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {selected.description}
                </p>
              )}
              {selected.variants && selected.variants.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-foreground-faint shrink-0">
                    {selected.variants.length} 种图表类型
                  </span>
                  {selected.variants.map((v) => (
                    <span
                      key={v}
                      className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground-faint"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {demoDsl ? (
              <div className="flex-1 overflow-y-auto bg-surface-sunken/40 p-3">
                <ErrorBoundary name={`CatalogDemo:${selected.name}`}>
                  <Renderer
                    library={analyticsLibrary}
                    response={demoDsl}
                    isStreaming={false}
                    publishObservability={false}
                  />
                </ErrorBoundary>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[11px] text-foreground-faint">
                DSL 根容器：仅作为页面顶层布局，无独立预览
              </div>
            )}
          </div>
        </div>

        {/* 底部：扩展提示 */}
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-sunken/50 shrink-0">
          <p className="text-[11px] text-foreground-faint leading-relaxed">
            预览为组件实况渲染（真实主题配色，亮暗自适应）。目录与渲染库同源维护：
            新增组件注册进{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-muted-foreground">
              @openui-analytics/components
            </code>{" "}
            后自动出现在此处。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
