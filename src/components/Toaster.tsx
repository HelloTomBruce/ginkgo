"use client";

import React from "react";
import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import {
  dismissToast,
  getToastsSnapshot,
  subscribeToasts,
  type ToastItem,
} from "@/lib/toast";

const KIND_STYLE: Record<ToastItem["kind"], string> = {
  success:
    "bg-success-soft border-success-border text-success-fg-strong",
  error:
    "bg-danger-soft border-danger-border text-danger-fg-strong",
  info: "bg-info-soft border-info-border text-info-fg-strong",
};

const KIND_ICON: Record<ToastItem["kind"], React.ReactNode> = {
  success: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
  error: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
  info: <Info className="w-3.5 h-3.5 shrink-0" />,
};

/**
 * 全局 toast 渲染层：挂载一次于 ChatDashboard，
 * 订阅 lib/toast 的模块级 store。
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToastsSnapshot);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs shadow-lg animate-in slide-in-from-right-2 ${KIND_STYLE[t.kind]}`}
        >
          {KIND_ICON[t.kind]}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <Hint label="关闭">
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="关闭提示"
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </Hint>
        </div>
      ))}
    </div>
  );
}
