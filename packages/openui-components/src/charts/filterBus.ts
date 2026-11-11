"use client";

import React, { createContext, useContext } from "react";

/**
 * 筛选事件总线（支持可选作用域 Scope）：
 * - AnalyticsFilterBar 广播筛选值
 * - SpecChart 订阅后自行合并 filters 并重物化回填（零 LLM）
 * - scopeId：当多个看板或多个消息同时存在时，隔离事件流，避免互相污染
 */

export interface FilterChangeEvent {
  /** 筛选字段名（= 数据源字段，即 SpecChart dims/filters 引用名） */
  field: string;
  /** 选中值（原始形态，标量） */
  value: string;
  /** 作用域标识（例如看板 ID 或消息 ID），未提供时为全局 */
  scopeId?: string;
}

export type FilterChangeListener = (event: FilterChangeEvent) => void;

interface ListenerEntry {
  cb: FilterChangeListener;
  scopeId?: string;
}

const listenerEntries = new Set<ListenerEntry>();

/** 广播筛选值变化（AnalyticsFilterBar onChange 调用） */
export function emitFilterChange(event: FilterChangeEvent): void {
  for (const entry of Array.from(listenerEntries)) {
    // 作用域匹配逻辑：
    // 1. 若监听方未限定 scopeId，则接收所有事件
    // 2. 若事件未带 scopeId，则属于全局广播，所有监听方接收
    // 3. 若均指定了 scopeId，则仅当相等时分发
    if (
      !entry.scopeId ||
      !event.scopeId ||
      entry.scopeId === event.scopeId
    ) {
      entry.cb(event);
    }
  }
}

/** 订阅筛选变化；返回取消订阅函数（SpecChart useEffect cleanup 调用） */
export function onFilterChange(cb: FilterChangeListener, scopeId?: string): () => void {
  const entry: ListenerEntry = { cb, scopeId };
  listenerEntries.add(entry);
  return () => {
    listenerEntries.delete(entry);
  };
}

/** 清理所有订阅者（主要供单测隔离使用） */
export function resetFilterBus(): void {
  listenerEntries.clear();
}

/** 看板/组件容器的作用域 Context */
export const DashboardScopeContext = createContext<string | undefined>(undefined);

/** 获取当前容器的作用域 ID（若无外层 Provider 则返回 undefined） */
export function useDashboardScope(): string | undefined {
  return useContext(DashboardScopeContext);
}

/** 作用域 Provider */
export const DashboardScopeProvider: React.FC<{
  scopeId?: string;
  children: React.ReactNode;
}> = ({ scopeId, children }) => {
  return React.createElement(
    DashboardScopeContext.Provider,
    { value: scopeId },
    children
  );
};
