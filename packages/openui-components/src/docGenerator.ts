import type { Library } from "@openuidev/lang-core";
import { z } from "zod";

/**
 * 针对各组件在 System Prompt 中的详细生成指引（针对特定数据绑定、布局约束的英文指导）。
 * 当组件元数据中无专属英文指引时，自动回退至组件自身的 description。
 */
export const DEFAULT_COMPONENT_PROMPT_GUIDES: Record<string, string> = {
  ReportLayout:
    "BI report layout template — page header + KPI strip + 2-col charts zone + full-width detail zone + insights zone + optional controls. Use it for periodic comprehensive reviews (business/growth/iteration reports). Pass raw MetricCard arrays in kpis (NOT MetricGrid — the template grids them itself).",
  FocusLayout:
    "deep-dive layout — wide main chart zone (2/3) + narrow sidebar insights (1/3) + optional bottom detail + optional controls. Use it for single-topic root-cause analysis / attribution (\"why did X rise/drop\"). The 1/3 sidebar fits ONLY compact widgets (InsightBox/GaugeProgress/single MetricCard/MetricGrid); put content-heavy components (ActionPlanCard/ActivityTimeline/DataTable) in detail, never in side.",
  ComparisonLayout:
    "side-by-side comparison layout with labeled panels + optional verdict zone + optional controls. Use it for A/B tests or comparing two channels/repos/members/versions.",
  MonitoringLayout:
    "System health / stability inspection / alert triage layout with status indicator, anomaly metrics, logs/details, and mitigation plans.",
  CohortRetentionLayout:
    "User cohort and lifecycle retention analysis template with headline metrics, retention matrix, decay curve, and verdict.",
  MetricCard:
    "KPI stats card with optional sparkline micro trend.",
  MetricGrid:
    "2, 3, or 4 column grid container for MetricCards.",
  AnalyticsChart:
    "Bar, Line, Area, or Pie charts.",
  SpecChart:
    'Declarative semantic chart — you declare a ChartSpec object (dims: category fields; meas: measures with aggregation sum/avg/count/min/max; chartType: "bar"|"stacked-bar"|"line"|"area"|"combo"|"pie"|"donut"|"scatter"|"table"; filters; sort; limit; style (thresholds: [{when:{field,op,value},color:"success"|"warning"|"danger"|"info"}] for conditional coloring; referenceLines: [{value,label?,color?}] for target/average lines); sourceId) instead of hand-building rendered rows. The system materializes the data and can refresh it later with ZERO LLM calls; changing spec.chartType switches the visual without changing the binding. PREFER SpecChart for source-table statistics. combo convention: bars = all measures except the last, line (right axis) = the last measure (e.g. counts + cumulative share for Pareto).',
  ComboChart:
    "Dual-axis mixed chart (bars for left axis volume, lines for right axis rates/percentages/averages).",
  DataTable:
    "Searchable, sortable, exportable table.",
  RankingList:
    "High-density ranking leaderboard for Top N items with relative progress bars and rank badges.",
  InsightBox:
    "Tip, Info, Warning, or Success callouts.",
  AnalyticsFilterBar:
    "Interactive filter. DECLARATIVE MODE (preferred): pass filterField {sourceId, field, table, label?} where field is a dimension/filter field shared with same-page SpecCharts — options are pulled from the source's distinct values and picking one live-refreshes matching SpecCharts with ZERO LLM calls. Demo mode (no filterField): legacy three-control form that submits a re-analysis prompt.",
  FunnelChart:
    "Marketing / sales pipeline conversion and drop-off funnel, or Story requirement lifecycle funnel.",
  GaugeProgress:
    "KPI goal achievement progress bar or Project completion rate.",
  ActionPlanCard:
    "AI recommended decision measures and actionable checklist with priority badges.",
  ActivityTimeline:
    "Event/commit/MR/sprint milestone chronological history with status indicators.",
  RadarChart:
    "Multi-dimensional evaluation (e.g. Member workload/capability, project risk rating, code quality audit).",
  ContributionHeatmap:
    "Commit / activity / task log density heatmap matrix.",
  ReactiveSimulator:
    "Interactive budget/workload forecasting calculator with local millisecond-speed reactive updates, form validation, and client CSV export.",
  ActionButton:
    "Triggerable client action / workflow button.",
};

/**
 * 从组件 props 的 Zod Schema 提取方法签名中的参数列表字符串
 * 例如：(title, subtitle?, kpis?, charts?)
 */
export function extractPropsSignature(schema: z.ZodTypeAny): string {
  if (!(schema instanceof z.ZodObject)) {
    return "()";
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const params: string[] = [];

  for (const [key, propSchema] of Object.entries(shape)) {
    const isOptional = propSchema.isOptional();
    params.push(isOptional ? `${key}?` : key);
  }

  return `(${params.join(", ")})`;
}

/**
 * 遍历 Library 中的组件定义，自动生成 System Prompt 的 Visual Component Kit 说明段落。
 * 消除 prompt.ts 中手工维护 20+ 组件名、参数和描述的硬编码。
 */
export function renderComponentKitDocumentation(
  library: Library,
  customGuides: Record<string, string> = DEFAULT_COMPONENT_PROMPT_GUIDES
): string {
  const lines: string[] = [
    "## Visual Component Kit (Dashboard DSL):",
    "You have a rich set of declarative components available:",
  ];

  // 排除 Root 根容器（Root 在 syntax rules 中单独解释）
  for (const [name, def] of Object.entries(library.components)) {
    if (name === "Root") continue;

    const signature = extractPropsSignature(def.props as z.ZodTypeAny);
    const guide = customGuides[name] ?? def.description ?? "";

    lines.push(`- **${name}${signature}**: ${guide}`);
  }

  return lines.join("\n");
}
