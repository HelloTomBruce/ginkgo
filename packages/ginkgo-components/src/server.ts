/**
 * 服务端安全出口（RSC/API Route 专用）：
 * serverLibrary（组件 kit schema 面）、DSL 解析器/序列化、kit 文档生成器与
 * 语法守卫——全部为 isomorphic 纯 zod/lang-core 实现，无 "use client" 指令。
 * 服务端代码（看板刷新/模板重绑定/应用 prompt 装配）必须从本子路径导入，
 * 不得经根入口（根入口带 "use client"，在 RSC 上下文会退化为客户端引用）。
 */
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
export { createParser, jsonToOpenUI as jsonToUiSpec } from "@openuidev/lang-core";
export {
  renderComponentKitDocumentation,
  extractPropsSignature,
  DEFAULT_COMPONENT_PROMPT_GUIDES,
} from "./docGenerator";
export {
  UiSpecDslValidator,
  createUiSpecDslValidator,
  type ValidationResult as DslValidationResult,
  type StructureValidator as DslStructureValidator,
} from "./uiSpecDslValidator";
