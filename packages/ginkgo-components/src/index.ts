"use client";

/**
 * @ginkgo/components —— UiSpec 规范展示组件库
 *
 * 分类目录（新增组件时按职能放入对应目录，文件内同时持有
 * React 组件与其 defineComponent 定义，最后在下方 CATALOG_GROUPS
 * 对应分组注册一行——library 渲染清单与组件展示目录均由此派生）：
 *
 *   layout/      布局与模板    Root、MetricGrid + 布局模板（ReportLayout/FocusLayout/ComparisonLayout/MonitoringLayout/CohortRetentionLayout）
 *   metrics/     指标类        MetricCard、GaugeProgress
 *   charts/      图表类        AnalyticsChart、SpecChart、ComboChart、FunnelChart、RadarChart、ContributionHeatmap（共享基建 registry/chartShared/filterBus）
 *   data/        数据明细      DataTable、RankingList
 *   insight/     洞察结论      InsightBox、ActionPlanCard
 *   timeline/    时间线        ActivityTimeline
 *   interaction/ 交互控件      AnalyticsFilterBar、ActionButton、ReactiveSimulator、PlanReviewCard
 *   spec/        声明式渲染    DashboardSpecRenderer（DashboardSpec 2.0 → 栅格看板）
 *   internal/    内部支撑      ErrorBoundary、ComponentSafeWrapper、layoutZone、parseProp、csv、niceScale（不对外承诺稳定性）
 *
 * 扩展指南见包内 README.md。
 */

import { createLibrary } from "@openuidev/react-lang";
import { CHART_TYPES } from "@ginkgo/chart-spec";

// layout
import { RootComponent } from "./layout/Root";
import { MetricGrid, MetricGridDef } from "./layout/MetricGrid";
import { ReportLayout, ReportLayoutDef } from "./layout/ReportLayout";
import { FocusLayout, FocusLayoutDef } from "./layout/FocusLayout";
import { ComparisonLayout, ComparisonLayoutDef } from "./layout/ComparisonLayout";
import { MonitoringLayout, MonitoringLayoutDef } from "./layout/MonitoringLayout";
import { CohortRetentionLayout, CohortRetentionLayoutDef } from "./layout/CohortRetentionLayout";
// metrics
import { MetricCard, MetricCardDef } from "./metrics/MetricCard";
import { GaugeProgress, GaugeProgressDef } from "./metrics/GaugeProgress";
// charts
import { AnalyticsChart, AnalyticsChartDef } from "./charts/AnalyticsChart";
import { SpecChart, SpecChartDef } from "./charts/SpecChart";
import { ComboChart, ComboChartDef } from "./charts/ComboChart";
import { FunnelChart, FunnelChartDef } from "./charts/FunnelChart";
import { RadarChart, RadarChartDef } from "./charts/RadarChart";
import { ContributionHeatmap, ContributionHeatmapDef } from "./charts/ContributionHeatmap";
// data
import { DataTable, DataTableDef } from "./data/DataTable";
import { RankingList, RankingListDef } from "./data/RankingList";
// insight
import { InsightBox, InsightBoxDef } from "./insight/InsightBox";
import { ActionPlanCard, ActionPlanCardDef } from "./insight/ActionPlanCard";
// timeline
import { ActivityTimeline, ActivityTimelineDef } from "./timeline/ActivityTimeline";
// interaction
import { AnalyticsFilterBar, AnalyticsFilterBarDef } from "./interaction/AnalyticsFilterBar";
import { ActionButton, ActionButtonDef } from "./interaction/ActionButton";
import { ReactiveSimulator, ReactiveSimulatorDef } from "./interaction/ReactiveSimulator";
import { PlanReviewCard, PlanReviewCardDef } from "./interaction/PlanReviewCard";

/**
 * 目录分组定义——组件注册的唯一事实来源：
 * library 渲染清单与 componentCatalog 展示目录都从这份数据派生，
 * 新增组件只需在此登记一次，不存在两份手工清单漂移的可能。
 */
const CATALOG_GROUPS = [
  {
    category: "布局与模板",
    defs: [
      RootComponent,
      MetricGridDef,
      ReportLayoutDef,
      FocusLayoutDef,
      ComparisonLayoutDef,
      MonitoringLayoutDef,
      CohortRetentionLayoutDef,
    ],
  },
  {
    category: "指标",
    defs: [MetricCardDef, GaugeProgressDef],
  },
  {
    category: "图表",
    defs: [
      AnalyticsChartDef,
      SpecChartDef,
      ComboChartDef,
      FunnelChartDef,
      RadarChartDef,
      ContributionHeatmapDef,
    ],
  },
  {
    category: "数据明细",
    defs: [DataTableDef, RankingListDef],
  },
  {
    category: "洞察结论",
    defs: [InsightBoxDef, ActionPlanCardDef],
  },
  {
    category: "时间线",
    defs: [ActivityTimelineDef],
  },
  {
    category: "交互控件",
    defs: [
      AnalyticsFilterBarDef,
      ActionButtonDef,
      ReactiveSimulatorDef,
      PlanReviewCardDef,
    ],
  },
] as const;

/** 组件可选子类型（按组件名声明；SpecChart 支持的图表类型派生自 CHART_TYPES） */
const ENTRY_VARIANTS: Record<string, readonly string[]> = {
  SpecChart: CHART_TYPES,
};

/**
 * UiSpec 组件库：传给 @openuidev/react-lang <Renderer library={...}/> 渲染。
 * root 固定为 "Root"；组件清单由 CATALOG_GROUPS 派生（Root 首位）。
 */
export const analyticsLibrary = createLibrary({
  components: CATALOG_GROUPS.flatMap((g) => [...g.defs]),
  root: "Root",
});

// ===== 对外导出：React 组件（可脱离 UiSpec DSL 直接在页面使用）=====
export {
  MetricGrid,
  ReportLayout,
  FocusLayout,
  ComparisonLayout,
  MonitoringLayout,
  CohortRetentionLayout,
  MetricCard,
  GaugeProgress,
  AnalyticsChart,
  SpecChart,
  ComboChart,
  FunnelChart,
  RadarChart,
  ContributionHeatmap,
  DataTable,
  RankingList,
  InsightBox,
  ActionPlanCard,
  ActivityTimeline,
  AnalyticsFilterBar,
  ActionButton,
  ReactiveSimulator,
  PlanReviewCard,
};

// ===== 对外导出：组件定义（组合自定义 library 时复用）=====
export { RootComponent };

// ===== 对外导出：共享基础设施（app 侧 UiSpecRenderer / clientTools 也依赖）=====
export { ErrorBoundary } from "./internal/ErrorBoundary";
export { toCsvContent, downloadCsv, escapeCsvCell } from "./internal/csv";
export { parseArrayProp } from "./internal/parseProp";
// 图表注册表（SpecChart 派发与方法卡配对依赖）
export {
  chartRegistry,
  getChartRenderer,
  type ChartRendererEntry,
  type RegistryRenderProps,
  type ChartStyleProps,
} from "./charts/registry";
export { CHART_COLORS, resolveSeries, type SeriesConfig } from "./charts/chartShared";
// 筛选联动总线（FilterBar 广播 → SpecChart 订阅自行物化）
export {
  emitFilterChange,
  onFilterChange,
  resetFilterBus,
  useDashboardScope,
  DashboardScopeProvider,
  DashboardScopeContext,
  type FilterChangeEvent,
} from "./charts/filterBus";

// ===== 对外导出：组件目录（供「可视化组件」查看入口展示）=====

/** 目录条目：名称与描述直接取自组件定义（Def），不重复维护文案 */
export interface ComponentCatalogEntry {
  /** UiSpec DSL 中的组件名（渲染标签名） */
  name: string;
  /** 组件职能描述 */
  description?: string;
  /** 可选子类型（如 SpecChart 支持的图表类型，派生自 CHART_TYPES） */
  variants?: readonly string[];
}

export interface ComponentCatalogGroup {
  /** 分类中文名 */
  category: string;
  components: readonly ComponentCatalogEntry[];
}

/** 最小投影：只取目录展示所需字段（Def 的 name/description 是唯一事实来源） */
function toCatalogEntry(
  def: { name: string; description?: string }
): ComponentCatalogEntry {
  const variants = ENTRY_VARIANTS[def.name];
  return { name: def.name, description: def.description, ...(variants ? { variants } : {}) };
}

/**
 * 组件目录：由 CATALOG_GROUPS 派生（与 analyticsLibrary 同一份注册数据），
 * 新增组件只需在 CATALOG_GROUPS 登记一次，目录与渲染清单自动同步。
 */
export const componentCatalog: readonly ComponentCatalogGroup[] =
  CATALOG_GROUPS.map((group) => ({
    category: group.category,
    components: group.defs.map((def) => toCatalogEntry(def)),
  }));

// 组件演示样例（可视化组件查看弹窗的条目实况预览；无演示的组件仅展示信息）
export { componentDemos } from "./componentDemos";

// DashboardSpec 2.0 声明式渲染容器 (Data-View Separation)
export {
  DashboardSpecRenderer,
  type DashboardSpecRendererProps,
} from "./spec/DashboardSpecRenderer";

// ===== 对外导出：平台渲染与 DSL 基础设施（宿主与应用包共用）=====

// UiSpec DSL 流式渲染引擎（客户端本地工具经 UiSpecToolProviderContext 注入）
export {
  UiSpecRenderer,
  UiSpecToolProvider,
  type UiSpecToolMap,
} from "./UiSpecRenderer";

// 服务端组件 kit（schema 面）：与 analyticsLibrary（React 面）同一组件集的 zod 定义，
// 供 System Prompt 组装、AST 校验与 DSL 序列化使用
export {
  serverLibrary,
  serverRoot,
  serverReportLayout,
  serverFocusLayout,
  serverComparisonLayout,
  serverMonitoringLayout,
  serverCohortRetentionLayout,
  serverMetricCard,
  serverAnalyticsChart,
  serverSpecChart,
  serverComboChart,
  serverDataTable,
  serverRankingList,
  serverInsightBox,
  serverMetricGrid,
  serverAnalyticsFilterBar,
  serverFunnelChart,
  serverGaugeProgress,
  serverActionPlanCard,
  serverActivityTimeline,
  serverRadarChart,
  serverContributionHeatmap,
  serverActionButton,
  serverReactiveSimulator,
  serverPlanReviewCard,
} from "./serverLibrary";
// RSC/Node 安全的解析器入口与 DSL 序列化（lang-core 纯实现，无 React 运行时）
export { createParser, jsonToOpenUI as jsonToUiSpec } from "@openuidev/lang-core";

// 组件 kit 的 System Prompt 文档生成器（机制 + 缺省指引文案）
export {
  renderComponentKitDocumentation,
  extractPropsSignature,
  DEFAULT_COMPONENT_PROMPT_GUIDES,
} from "./docGenerator";

// UiSpec DSL 语法守卫（StructureValidator 契约，可插拔进 harness-core 自愈护栏）
export {
  UiSpecDslValidator,
  createUiSpecDslValidator,
  type ValidationResult as DslValidationResult,
  type StructureValidator as DslStructureValidator,
} from "./uiSpecDslValidator";

// 跨应用通用展示与交互工具组件
export {
  DiffViewer,
  computeLineDiff,
  parseUnifiedDiff,
  type DiffViewerProps,
  type DiffLine,
} from "./tools/DiffViewer";
export {
  ApprovalCard,
  type ApprovalCardProps,
} from "./tools/ApprovalCard";
export {
  TerminalViewer,
  type TerminalViewerProps,
} from "./tools/TerminalViewer";

