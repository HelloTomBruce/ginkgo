"use client";

/**
 * 筛选事件总线（M2 筛选联动）：AnalyticsFilterBar 广播筛选值，
 * SpecChart 订阅后自行合并 filters 并重物化回填（零 LLM）。
 *
 * 设计取舍：不用 dsl 贯穿传递/中心化 targets 编排——声明式的天然作用域是
 * 「筛选字段 ∈ 本图表 dims/filters 字段」，由订阅方自行判定是否响应；
 * 模块级单例即可（同页同应用，无跨端场景）。
 */

export interface FilterChangeEvent {
  /** 筛选字段名（= 数据源字段，即 SpecChart dims/filters 引用名） */
  field: string;
  /** 选中值（原始形态，标量） */
  value: string;
}

type Listener = (event: FilterChangeEvent) => void;

const listeners = new Set<Listener>();

/** 广播筛选值变化（AnalyticsFilterBar onChange 调用） */
export function emitFilterChange(event: FilterChangeEvent): void {
  for (const cb of listeners) cb(event);
}

/** 订阅筛选变化；返回取消订阅函数（SpecChart useEffect cleanup 调用） */
export function onFilterChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
