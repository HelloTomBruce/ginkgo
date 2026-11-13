/**
 * MCP 连接器网关类型契约
 */

export interface QueryCacheKey {
  sourceId: string;
  sqlHash: string;
  paramsHash: string;
}

export interface ExplainCostReport {
  /** 语法与表结构是否通过 */
  isValid: boolean;
  /** 预估扫描行数 */
  estimatedRows: number;
  /** 预估扫描字节数（若数仓支持，如 ClickHouse/BigQuery） */
  estimatedBytes?: number;
  /** 语法或执行计划错误信息 */
  syntaxError?: string;
  /** 是否存在全表扫描高风险 */
  isFullTableScan: boolean;
  /** 是否超过扫描预算阈值 */
  exceedsBudget: boolean;
  /** 针对模型自愈的建议提示 */
  costWarning?: string;
  /** EXPLAIN 预检因方言不支持/基础设施异常而降级放行（未做成本评估） */
  degraded?: boolean;
  /** 原始 EXPLAIN 输出摘要 */
  planRaw?: unknown;
}

export interface ExplainOptions {
  /** 单次查询最大预估扫描行数预算（默认 1,000,000） */
  maxScanRowsBudget?: number;
  /** 是否对全表扫描进行强制熔断（默认 true） */
  blockFullTableScan?: boolean;
}

export interface QueryResultWithMeta {
  rows: Record<string, unknown>[];
  rowCount: number;
  /** 是否命中结果集缓存 */
  cacheHit?: boolean;
  /** 缓存写入时间戳 */
  cachedAt?: number;
  /** 执行耗时（毫秒） */
  durationMs?: number;
  /** 经 EXPLAIN 预检的成本报告摘要 */
  explainReport?: ExplainCostReport;
}

export interface ExecuteQueryArgs {
  sourceId: string;
  sql: string;
  params?: unknown[];
  /** 是否跳过缓存强制直连数仓 */
  skipCache?: boolean;
  /** 是否跳过 EXPLAIN 成本门禁（特定受信任查询使用） */
  bypassExplain?: boolean;
  /** 自定义缓存 TTL（毫秒，缺省使用网关配置） */
  cacheTtlMs?: number;
}

export interface CatalogOverviewItem {
  sourceId: string;
  name: string;
  type: string;
  tables: string[];
  description?: string;
}

export interface TableDetailResource {
  sourceId: string;
  tableName: string;
  columns: Array<{
    name: string;
    type: string;
    comment?: string;
  }>;
  sampleRows: Record<string, unknown>[];
}

export interface McpGatewayConfig {
  /** 默认缓存 TTL，默认 15 分钟 (900,000 ms) */
  defaultCacheTtlMs?: number;
  /** 缓存容量最大条目数，默认 500 */
  maxCacheEntries?: number;
  /** 成本门禁默认配置 */
  explainOptions?: ExplainOptions;
}
