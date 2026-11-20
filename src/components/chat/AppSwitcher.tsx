"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  TrendingUp,
  Bot,
  BarChart3,
  Check,
  ChevronDown,
  LayoutGrid,
  Sparkles,
} from "lucide-react";
import type { AppDefinition } from "@/types/app";
import { listApps, getDefaultApp } from "@/lib/apps/registry";

interface AppSwitcherProps {
  activeAppId: string;
  onSwitchApp: (appId: string) => void;
  apps?: AppDefinition[];
}

function renderAppIcon(iconName: string, className = "w-4 h-4") {
  switch (iconName.toLowerCase()) {
    case "trendingup":
      return <TrendingUp className={className} />;
    case "bot":
      return <Bot className={className} />;
    case "barchart3":
      return <BarChart3 className={className} />;
    case "sparkles":
      return <Sparkles className={className} />;
    default:
      return <LayoutGrid className={className} />;
  }
}

export function AppSwitcher({
  activeAppId,
  onSwitchApp,
  apps = listApps(),
}: AppSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentApp =
    apps.find((a) => a.manifest.id === activeAppId) ?? getDefaultApp();

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2.5 p-2 rounded-xl border border-border bg-card hover:bg-muted text-foreground transition-all duration-150 group text-left"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-testid="app-switcher-button"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0 shadow-2xs">
            {renderAppIcon(currentApp.manifest.icon, "w-4 h-4")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs leading-none truncate text-foreground">
                {currentApp.manifest.name}
              </span>
              {currentApp.manifest.category && (
                <span className="text-[10px] px-1.5 py-0.2 bg-info-soft text-info-fg rounded font-normal shrink-0">
                  {currentApp.manifest.category}
                </span>
              )}
            </div>
            <p className="text-[11px] text-foreground-faint truncate mt-0.5">
              {currentApp.manifest.description}
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-foreground-subtle shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-foreground" : "group-hover:text-foreground"
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          data-testid="app-switcher-menu"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 p-1.5 rounded-xl border border-border bg-card shadow-lg backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <div className="px-2 py-1 text-[11px] font-medium text-foreground-faint">
            选择切换工作台应用
          </div>
          <div className="space-y-1 mt-1">
            {apps.map((app) => {
              const isSelected = app.manifest.id === activeAppId;
              return (
                <button
                  key={app.manifest.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSwitchApp(app.manifest.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    isSelected
                      ? "bg-info-soft text-info-fg font-medium"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                        isSelected
                          ? "bg-info-soft text-info-fg"
                          : "bg-surface-sunken text-foreground"
                      }`}
                    >
                      {renderAppIcon(app.manifest.icon, "w-3.5 h-3.5")}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs leading-none font-medium truncate">
                        {app.manifest.name}
                      </div>
                      <div className="text-[10px] text-foreground-subtle truncate mt-0.5">
                        {app.manifest.description}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-info-fg shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
