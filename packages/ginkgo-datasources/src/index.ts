/**
 * @ginkgolab/datasources 统一入口。
 * 主入口 client-safe（前端仅 import type）；ai 适配器走子路径
 * `@ginkgolab/datasources/adapters/ai`（optional peerDependency）。
 */
export * from "./config";
export * from "./manager";
export {
  FILE_SOURCE_MAX_BYTES,
  FILE_SOURCE_EXTENSIONS,
  isSupportedUpload,
  sanitizeTableName,
  type FileSourceManifest,
  type FileTableInfo,
  type FileSourceUpload,
} from "./connectors/file/fileStore";
// Schema Card：类型与渲染为 client-safe（含 node:fs 的 store 不走主入口，
// 服务端经子路径 @ginkgolab/datasources/schema/store 引入）
export {
  type SchemaCard,
  type SchemaCardTable,
  type SchemaCardColumn,
  type SchemaCardToolSummary,
  type RawTableProfile,
  CARD_RENDER_BUDGET_BYTES,
  CARD_STORE_MAX_BYTES,
  LOW_CARDINALITY_THRESHOLD,
  renderCardForPrompt,
  scoreTableRelevance,
  type RenderCardOptions,
} from "./schema/card";

// 数据源查询网关 (Gateway)
export * from "./gateway/types";
export * from "./gateway/explainGuard";
export * from "./gateway/queryCache";
export * from "./gateway/queryPipeline";
export * from "./gateway/queryGateway";

// Certified Queries 语义层与口径治理 (Certified)
export * from "./certified/types";
export * from "./certified/certifiedStore";
export * from "./certified/semanticRouter";

/**
 * 受支持的关系型 dbType 词汇表（由 `connectors/db/*Dialect.ts` 的事实存在派生）。
 *
 * 为什么在能力包导出：合法值由 dialect 实现定义，宿主设置 UI 直接消费本常量，
 * 避免「能力包新增 dialect、宿主枚举忘了同步」的双处维护漂移。
 * 文件类源（csv/excel → DuckDB）不属于 dbType，故不含 "duckdb"。
 */
export const SUPPORTED_DB_TYPES = ["postgres", "mysql", "sqlite", "clickhouse"] as const;

export type SupportedDbType = (typeof SUPPORTED_DB_TYPES)[number];
