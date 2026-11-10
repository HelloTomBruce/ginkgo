"use client";

/**
 * 图表渲染共享基建（注册表渲染器与 AnalyticsChart 共用）：
 * - CHART_COLORS：主题色唯一来源 var(--chart-1..6)，var() 透传 SVG 属性，
 *   禁止在任何图表组件写死色值（AGENTS.md 颜色 token 约束）
 * - resolveSeries：系列解析 + 数值字段自动提取（原 AnalyticsChart 内联逻辑抽出）
 */
import { parseArrayProp } from "../internal/parseProp";
import type { ChartSpec } from "@openui-analytics/chart-spec";

/** 条件样式/辅助线的语义色类型（与 chart-spec 契约同源） */
export type SemanticColorName = NonNullable<
  NonNullable<ChartSpec["style"]>["thresholds"]
>[number]["color"];
export type ThresholdRule = NonNullable<
  NonNullable<ChartSpec["style"]>["thresholds"]
>[number];
export type ReferenceLineSpec = NonNullable<
  NonNullable<ChartSpec["style"]>["referenceLines"]
>[number];

/**
 * 语义色名 → globals.css solid token（唯一颜色事实来源）：
 * SVG fill/stroke 用 var() 透传，禁止任何裸色值（AGENTS.md 约束）。
 */
export const SEMANTIC_SOLID: Record<SemanticColorName, string> = {
  success: "var(--success-solid)",
  warning: "var(--warning-solid)",
  danger: "var(--danger-solid)",
  info: "var(--info-solid)",
};

/** 数字化比较基元：数字与数字字符串互认（LLM 偶发字符串化） */
export function asNumberOr(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 单条阈值规则判定（row 为物化行，字段 = 维度/指标输出别名） */
export function matchesThreshold(
  row: Record<string, unknown>,
  when: ThresholdRule["when"]
): boolean {
  const v = asNumberOr(row[when.field]);
  if (v === null) return false;
  switch (when.op) {
    case "gt":
      return v > when.value;
    case "gte":
      return v >= when.value;
    case "lt":
      return v < when.value;
    case "lte":
      return v <= when.value;
  }
}

/**
 * 行级阈值填充色：命中第一条规则即返回对应 solid token，未命中返回 undefined
 * （调用方回退基础系列色）。
 */
export function thresholdCellFill(
  row: Record<string, unknown>,
  thresholds: readonly ThresholdRule[] | undefined
): string | undefined {
  if (!thresholds || thresholds.length === 0) return undefined;
  for (const t of thresholds) {
    if (matchesThreshold(row, t.when)) return SEMANTIC_SOLID[t.color];
  }
  return undefined;
}

/* 系列色读取主题 token（--chart-1..6，见应用层 globals.css），
 * var() 引用直接透传到 SVG 属性，浏览器端解析，SSR/测试环境无需兜底 */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export interface SeriesConfig {
  key: string;
  label?: string;
  color?: string;
}

/**
 * 系列解析：显式 series 过滤非法项；缺省时从首行自动提取数值字段作为序列
 * （优先数值列，全非数值时退化为除 xAxisKey 外的全部列）。
 */
export function resolveSeries(
  series: unknown,
  rows: Array<Record<string, unknown>>,
  xAxisKey: string
): SeriesConfig[] {
  let s = parseArrayProp(series).filter(
    (item) => typeof item.key === "string"
  ) as unknown as SeriesConfig[];

  if (s.length === 0 && rows.length > 0 && rows[0] && typeof rows[0] === "object") {
    const firstRow = rows[0];
    const candidateKeys = Object.keys(firstRow).filter(
      (k) => k !== xAxisKey && typeof firstRow[k] === "number"
    );
    if (candidateKeys.length === 0) {
      candidateKeys.push(
        ...Object.keys(firstRow).filter((k) => k !== xAxisKey)
      );
    }
    s = candidateKeys.map((k, idx) => ({
      key: k,
      label: k,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }));
  }
  return s;
}
