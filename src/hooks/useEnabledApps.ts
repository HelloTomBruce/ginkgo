"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 已启用应用集合（服务端事实来源）。
 *
 * 为什么需要它：客户端的 `appRegistry` 是**打包期常量**，服务端启停一个应用
 * 不会改变它。此前用 `appsVersion` 这类无效状态试图"刷新"客户端注册表，
 * 实际上没有任何数据可刷新（memo 重算结果恒等）。启用态的唯一真相是
 * `GET /api/apps`。
 *
 * `ids === null` 表示尚未加载：此时调用方应保持现状（不过滤），
 * 避免首屏闪一下"应用列表为空"。
 */
export interface EnabledAppsState {
  /** 已启用应用 id 集合；null = 尚未加载 */
  ids: Set<string> | null;
  /** 最近一次加载失败的原因（用于提示，不阻断渲染） */
  error: string | null;
  /** 重新拉取；返回最新集合（失败返回 null），供事件回调做后续判定 */
  refresh: () => Promise<Set<string> | null>;
}

export function useEnabledApps(): EnabledAppsState {
  const [ids, setIds] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 纯取数（不碰 state），供挂载 effect 与事件回调共用 */
  const fetchEnabledIds = useCallback(async (): Promise<Set<string>> => {
    const res = await fetch("/api/apps");
    if (!res.ok) {
      throw new Error(`加载应用启用状态失败（HTTP ${res.status}）`);
    }
    const data = (await res.json()) as {
      apps?: Array<{ id: string; enabled: boolean }>;
    };
    const next = new Set<string>();
    for (const app of data.apps ?? []) {
      if (app.enabled) next.add(app.id);
    }
    return next;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchEnabledIds();
      setIds(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [fetchEnabledIds]);

  // 首屏拉取：setState 只发生在 promise 回调里（避免 effect 内同步 setState 级联渲染）
  useEffect(() => {
    let cancelled = false;
    fetchEnabledIds()
      .then((next) => {
        if (cancelled) return;
        setIds(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetchEnabledIds]);

  return { ids, error, refresh };
}
