"use client";

import React, { useState, useRef, useEffect } from "react";
import { Bot, ChevronDown, Check, Plus, Settings } from "lucide-react";
import type { ConfiguredProvider } from "@/lib/llmProviders";
import { getModelId } from "@/lib/llmProviders";

export interface ModelSwitcherProps {
  providers: ConfiguredProvider[];
  activeProviderId: string;
  activeModel: string;
  onSwitchModel: (providerId: string, model: string) => void;
  onOpenSettings?: () => void;
  /** 外观变体：header 顶部导航条（带边框胶囊），或 compact 底部输入栏极简 pill */
  variant?: "header" | "compact";
  /** 弹出位置：top 朝上弹出（输入框场景），bottom 朝下弹出（导航栏场景）。缺省由 variant 自动判定 */
  placement?: "top" | "bottom";
  /** 是否展示提供商名称（默认为 compact 模式不展示仅展示模型名，header 模式展示 Provider / Model） */
  showProvider?: boolean;
  className?: string;
}

export function ModelSwitcher({
  providers,
  activeProviderId,
  activeModel,
  onSwitchModel,
  onOpenSettings,
  variant = "header",
  placement,
  showProvider,
  className = "",
}: ModelSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const resolvedPlacement = placement ?? (variant === "compact" ? "top" : "bottom");
  const shouldShowProvider = showProvider ?? (variant !== "compact");

  const activeProvider =
    providers.find((p) => p.id === activeProviderId) || providers[0];

  const hasApiKey = Boolean(activeProvider?.apiKey?.trim());

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

  const displayName = activeProvider?.name || activeProviderId || "OpenAI";

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={
          shouldShowProvider
            ? `切换模型：当前 ${displayName} ${activeModel}`
            : `切换模型：当前 ${activeModel}`
        }
        className={
          variant === "header"
            ? "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-surface-sunken hover:bg-muted text-foreground transition-colors cursor-pointer select-none"
            : "flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-foreground-subtle hover:text-foreground hover:bg-surface-raised transition-colors cursor-pointer select-none"
        }
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            hasApiKey ? "bg-success-solid" : "bg-foreground-faint"
          }`}
          title={hasApiKey ? "已配置 API Key" : "未配置 API Key"}
        />
        <Bot className="w-3.5 h-3.5 text-info-fg shrink-0" />
        <span className="font-medium truncate max-w-[140px] sm:max-w-[200px]">
          {shouldShowProvider ? `${displayName} / ${activeModel}` : activeModel}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* 下拉/上浮弹层 */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute z-50 w-72 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-1.5 text-xs text-foreground animate-in fade-in-0 ${
            resolvedPlacement === "top"
              ? "bottom-full mb-2 left-0 slide-in-from-bottom-2"
              : "top-full mt-1.5 right-0 zoom-in-95"
          }`}
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-foreground-faint uppercase tracking-wider flex items-center justify-between border-b border-border-subtle pb-1.5 mb-1">
            <span>选择模型</span>
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                className="hover:text-info-fg transition-colors flex items-center gap-0.5 text-[11px] font-normal"
              >
                <Settings className="w-3 h-3" />
                <span>配置</span>
              </button>
            )}
          </div>

          <div className="space-y-2 py-1">
            {providers.map((provider) => {
              const isConfigured = Boolean(provider.apiKey?.trim());
              const isCurrentProvider = provider.id === activeProviderId;
              const models = provider.models || [];

              return (
                <div key={provider.id} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground font-medium">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isConfigured ? "bg-success-solid" : "bg-foreground-faint"
                      }`}
                    />
                    <span className="font-semibold text-foreground-strong">
                      {provider.name}
                    </span>
                    {provider.type === "custom" && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-surface-raised text-foreground-faint border border-border-subtle">
                        自定义
                      </span>
                    )}
                  </div>

                  {models.length === 0 ? (
                    <div className="px-4 py-1 text-[11px] text-foreground-faint italic">
                      暂无配置模型
                    </div>
                  ) : (
                    models.map((item) => {
                      const m = getModelId(item);
                      const isSelected = isCurrentProvider && activeModel === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            onSwitchModel(provider.id, m);
                            setIsOpen(false);
                          }}
                          className={`w-full text-left flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-info-soft text-info-fg-strong font-medium"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <span className="truncate">{m}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0 text-info-fg" />}
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>

          {onOpenSettings && (
            <div className="mt-1 pt-1.5 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-foreground-subtle hover:text-info-fg hover:bg-info-soft rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加或管理模型提供商...</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
