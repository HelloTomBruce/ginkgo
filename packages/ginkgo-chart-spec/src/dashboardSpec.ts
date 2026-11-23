import { z } from "zod";
import { ChartSpecSchema } from "./index";

/**
 * 查询管道声明：指定取数源、SQL/工具调用与参数
 */
export const QueryPipelineSpecSchema = z.object({
  sourceId: z.string().min(1, "sourceId 不能为空"),
  sql: z.string().min(1, "sql 不能为空"),
  params: z.record(z.string(), z.unknown()).optional(),
  certifiedQueryId: z.string().optional(),
  cacheTtl: z.number().nonnegative().optional(),
});
export type QueryPipelineSpec = z.infer<typeof QueryPipelineSpecSchema>;

/**
 * 栅格布局声明
 */
export const LayoutGridItemSchema = z.object({
  id: z.string().min(1),
  colSpan: z.number().int().min(1).max(12).default(12),
  rowSpan: z.number().int().min(1).optional(),
});

export const LayoutRowSchema = z.object({
  id: z.string().min(1),
  widgets: z.array(LayoutGridItemSchema),
});

export const DashboardLayoutSchema = z.object({
  columns: z.number().int().min(1).max(24).default(12),
  gap: z.number().nonnegative().default(4),
  rows: z.array(LayoutRowSchema),
});
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;

/**
 * 组件数据绑定
 */
export const QueryBindingSchema = z.object({
  queryId: z.string().min(1),
  dimensionField: z.string().optional(),
  metricFields: z.array(z.string()).optional(),
  filterConditions: z.record(z.string(), z.unknown()).optional(),
});
export type QueryBinding = z.infer<typeof QueryBindingSchema>;

/**
 * 声明式组件部件定义（Widget）
 */
export const WidgetSpecSchema = z.object({
  type: z.enum([
    "MetricCard",
    "AnalyticsChart",
    "ComboChart",
    "FunnelChart",
    "DataTable",
    "RankingList",
    "InsightBox",
    "GaugeProgress",
    "SpecChart",
  ]),
  title: z.string(),
  description: z.string().optional(),
  /** 数据源绑定：绑定 queries 中的指定 queryId */
  queryBinding: QueryBindingSchema.optional(),
  /** 专有图表/组件外观配置项 */
  chartConfig: z.record(z.string(), z.unknown()).optional(),
  /** 若绑定为 SpecChart，可直接复用成熟的 ChartSpec */
  chartSpec: z.lazy(() => ChartSpecSchema).optional(),
  /** 静态兜底数据（离线或纯演示模式） */
  staticData: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type WidgetSpec = z.infer<typeof WidgetSpecSchema>;

/**
 * 看板元数据
 */
export const DashboardMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  themeTokens: z.record(z.string(), z.string()).optional(),
});

/**
 * DashboardSpec 2.0 顶层根模式
 */
export const DashboardSpecSchema = z.object({
  version: z.literal("2.0"),
  metadata: DashboardMetadataSchema,
  queries: z.record(z.string(), QueryPipelineSpecSchema).default({}),
  layout: DashboardLayoutSchema,
  widgets: z.record(z.string(), WidgetSpecSchema),
});
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

/**
 * 校验并解析 DashboardSpec 2.0 规格
 */
export function parseDashboardSpec(input: unknown): DashboardSpec {
  return DashboardSpecSchema.parse(input);
}

/**
 * 安全解析 DashboardSpec 2.0 规格
 */
export function safeParseDashboardSpec(
  input: unknown
): ReturnType<typeof DashboardSpecSchema.safeParse> {
  return DashboardSpecSchema.safeParse(input);
}
