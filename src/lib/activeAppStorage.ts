"use client";

import { appRegistry, DEFAULT_APP_ID } from "@/lib/apps/registry";

/** 活跃应用 ID 的 localStorage 持久化键 */
export const STORAGE_ACTIVE_APP_ID_KEY = "ginkgo_active_app_id";

/** 读取初始活跃应用 ID：localStorage 恢复（校验注册表合法性）→ 平台默认应用 */
export function getInitialAppId(): string {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STORAGE_ACTIVE_APP_ID_KEY);
      if (saved && appRegistry.has(saved)) {
        return saved;
      }
    } catch {
      // ignore（隐私模式等 localStorage 不可用场景）
    }
  }
  return DEFAULT_APP_ID;
}

/** 持久化活跃应用 ID（失败静默，非关键路径） */
export function saveActiveAppId(appId: string): void {
  try {
    localStorage.setItem(STORAGE_ACTIVE_APP_ID_KEY, appId);
  } catch {
    // ignore
  }
}
