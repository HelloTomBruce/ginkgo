"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Bot,
  ChevronDown,
  Check,
  Plus,
  Settings,
  Search,
  Sparkles,
  Clock,
  X,
} from "lucide-react";
import type { ConfiguredProvider, RecentModelItem } from "@/lib/llmProviders";
import {
  getModelId,
  normalizeModel,
  isReasoningModel,
  isModelEnabled,
  getRecentModels,
} from "@/lib/llmProviders";

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
  /** 最近使用的模型列表（若未传则从 localStorage 自动读取） */
  recentModels?: RecentModelItem[];
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
  recentModels: propRecentModels,
  className = "",
}: ModelSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const resolvedPlacement = placement ?? (variant === "compact" ? "top" : "bottom");
  const shouldShowProvider = showProvider ?? (variant !== "compact");

  const activeProvider =
    providers.find((p) => p.id === activeProviderId) || providers[0];

  const hasApiKey = Boolean(activeProvider?.apiKey?.trim());

  // 聚焦搜索输入框
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleToggleOpen = () => {
    setIsOpen((prev) => {
      if (!prev) {
        setSearchQuery("");
      }
      return !prev;
    });
  };

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

  // 获取最近使用模型列表（最近 3 个）
  const recentList = useMemo(() => {
    const raw = propRecentModels || getRecentModels();
    if (!raw || raw.length === 0) return [];
    // 过滤出存在于当前 providers 配置中的有效项
    return raw
      .filter((item) => {
        const prov = providers.find((p) => p.id === item.providerId);
        if (!prov) return false;
        return (prov.models || []).some((m) => getModelId(m) === item.model);
      })
      .slice(0, 3);
  }, [propRecentModels, providers]);

  // 过滤提供商与模型（支持搜索过滤与已启用过滤）
  const filteredProviders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return providers
      .map((provider) => {
        const models = (provider.models || []).filter((item) => {
          const modelId = getModelId(item);
          // 仅展示启用的模型，除非当前正搜索且匹配 ID
          const isEnabled = isModelEnabled(item);
          if (!q) return isEnabled;
          const matchQuery =
            modelId.toLowerCase().includes(q) ||
            provider.name.toLowerCase().includes(q);
          return matchQuery;
        });

        return {
          ...provider,
          filteredModels: models,
        };
      })
      .filter((provider) => {
        if (!searchQuery.trim()) return true;
        return (
          provider.filteredModels.length > 0 ||
          provider.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
        );
      });
  }, [providers, searchQuery]);

  const totalFilteredModels = useMemo(() => {
    return filteredProviders.reduce((acc, p) => acc + p.filteredModels.length, 0);
  }, [filteredProviders]);

  const handleSelect = (providerId: string, model: string) => {
    onSwitchModel(providerId, model);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={handleToggleOpen}
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
            : "flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-foreground-subtle hover:text-foreground hover:bg-surface-raised transition-colors cursor-pointer select-none"
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
          className={`absolute z-50 w-80 max-h-[30rem] flex flex-col rounded-xl border border-border bg-card shadow-xl text-xs text-foreground animate-in fade-in-0 overflow-hidden ${
            resolvedPlacement === "top"
              ? "bottom-full mb-2 left-0 slide-in-from-bottom-2"
              : "top-full mt-1.5 right-0 zoom-in-95"
          }`}
        >
          {/* 弹窗顶部栏 */}
          <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle bg-surface-sunken/40 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-foreground-faint uppercase tracking-wider">
              <span>选择模型</span>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenSettings();
                  }}
                  className="hover:text-info-fg transition-colors flex items-center gap-1 text-[11px] font-normal lowercase tracking-normal"
                >
                  <Settings className="w-3 h-3" />
                  <span>管理</span>
                </button>
              )}
            </div>

            {/* 即时搜索框 */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索模型或提供商..."
                className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-1 focus:ring-ring transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 text-foreground-faint hover:text-foreground p-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 滚动区域 */}
          <div className="overflow-y-auto flex-1 p-2 space-y-3">
            {/* 最近使用 (Recent) 快捷区（在未搜索且有历史记录时展示） */}
            {!searchQuery.trim() && recentList.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground font-medium">
                  <Clock className="w-3 h-3 text-info-fg" />
                  <span>最近使用</span>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {recentList.map((item) => {
                    const provider = providers.find((p) => p.id === item.providerId);
                    const providerName = provider?.name || item.providerId;
                    const modelConfig = (provider?.models || [])
                      .map(normalizeModel)
                      .find((m) => m.id === item.model);
                    const isSelected =
                      activeProviderId === item.providerId &&
                      activeModel === item.model;
                    const isReasoning = isReasoningModel(item.model, modelConfig);

                    return (
                      <button
                        key={`recent-${item.providerId}-${item.model}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(item.providerId, item.model)}
                        className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-info-soft text-info-fg-strong font-medium"
                            : "hover:bg-muted text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate font-mono">{item.model}</span>
                          <span className="text-[10px] text-foreground-faint shrink-0">
                            ({providerName})
                          </span>
                          {isReasoning && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-brand-soft border border-brand-soft-strong text-brand-fg font-medium flex items-center gap-0.5 shrink-0">
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>思考</span>
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 shrink-0 text-info-fg ml-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="border-b border-border-subtle pt-1" />
              </div>
            )}

            {/* 无搜索结果 */}
            {searchQuery.trim() && totalFilteredModels === 0 ? (
              <div className="py-6 text-center text-foreground-faint text-xs">
                未找到匹配的模型或提供商
              </div>
            ) : (
              /* 按 Provider 分组展示 */
              filteredProviders.map((provider) => {
                const isConfigured = Boolean(provider.apiKey?.trim());
                const isCurrentProvider = provider.id === activeProviderId;
                const models = provider.filteredModels;

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
                      <span className="text-[10px] text-foreground-faint ml-auto font-mono">
                        {models.length} 个模型
                      </span>
                    </div>

                    {models.length === 0 ? (
                      <div className="px-4 py-1 text-[11px] text-foreground-faint italic">
                        暂无配置模型
                      </div>
                    ) : (
                      models.map((rawItem) => {
                        const m = getModelId(rawItem);
                        const modelConfig = normalizeModel(rawItem);
                        const isSelected = isCurrentProvider && activeModel === m;
                        const isReasoning = isReasoningModel(m, modelConfig);
                        const ctx = modelConfig.contextWindow;

                        return (
                          <button
                            key={m}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleSelect(provider.id, m)}
                            className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-info-soft text-info-fg-strong font-medium"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate font-mono">{m}</span>
                              {isReasoning && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-brand-soft border border-brand-soft-strong text-brand-fg font-medium flex items-center gap-0.5 shrink-0">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>思考</span>
                                </span>
                              )}
                              {ctx && Number(ctx) > 0 && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-surface-raised text-foreground-faint font-mono shrink-0">
                                  {Math.round(Number(ctx) / 1000)}k
                                </span>
                              )}
                            </div>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 shrink-0 text-info-fg ml-1" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 底部常驻管理入口 */}
          {onOpenSettings && (
            <div className="p-2 border-t border-border-subtle bg-surface-sunken/40">
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
