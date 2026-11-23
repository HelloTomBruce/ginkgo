import { assertReadOnlySql } from "../connectors/db/sqlGuard";
import type { DbDialectClient } from "../connectors/db/sqlGuard";
import { dryRunExplain } from "./explainGuard";
import { computeQueryHashKey, QueryCacheManager } from "./queryCache";
import type { ExplainCostReport, ExplainOptions } from "./types";

export interface SqlGuardPipelineOptions<T> {
  sourceId: string;
  sql: string;
  params?: unknown[];
  /** 跳过结果集缓存，强制直连数仓 */
  skipCache?: boolean;
  /** 跳过 EXPLAIN 成本门禁（样本探查等受信任场景） */
  bypassExplain?: boolean;
  /** 自定义缓存 TTL（毫秒），缺省用缓存管理器默认 */
  cacheTtlMs?: number;
  /** 已建立连接的方言客户端（无则跳过 EXPLAIN 预检） */
  dialectClient?: { client: DbDialectClient; dbType: string };
  /** 共享的结果集缓存（manager 与 McpGateway 必须同一实例，失效才一致） */
  cache: QueryCacheManager<unknown>;
  explainOptions?: ExplainOptions;
  /** 缓存未命中且通过门禁后的真实执行器，返回已解析的结果 */
  execute: () => Promise<T>;
  /** 日志前缀（如 `Dynamic <sourceId>`） */
  logPrefix?: string;
}

export interface SqlGuardPipelineResult<T> {
  data: T;
  cacheHit: boolean;
  cachedAt?: number;
  explainReport?: ExplainCostReport;
}

/**
 * SQL 执行守卫管线（manager 工具绑定与 McpGateway 共用的唯一事实源）：
 * 只读词法断言 → 结果集缓存探查 → EXPLAIN 成本门禁（可降级）→ 真实执行 → 回写缓存。
 */
export async function executeSqlWithGuards<T>(
  opts: SqlGuardPipelineOptions<T>
): Promise<SqlGuardPipelineResult<T>> {
  const sql = opts.sql.trim();

  // 1. 词法级只读断言（杜绝写操作与多语句）
  assertReadOnlySql(sql);

  // 2. 结果集缓存探查（除非显式 skipCache）
  const cacheKey = computeQueryHashKey(opts.sourceId, sql, opts.params);
  if (!opts.skipCache) {
    const cached = opts.cache.get(cacheKey);
    if (cached) {
      if (opts.logPrefix) {
        console.log(
          `[${opts.logPrefix}] 命中 MCP 网关查询缓存 (SQL Hash: ${cacheKey.sqlHash.slice(0, 8)})`
        );
      }
      return {
        data: cached.data as T,
        cacheHit: true,
        cachedAt: cached.cachedAt,
      };
    }
  }

  // 3. EXPLAIN Dry-run 执行计划预检（方言连接可用时；内部已处理降级）
  let explainReport: ExplainCostReport | undefined;
  if (opts.dialectClient && !opts.bypassExplain) {
    explainReport = await dryRunExplain(
      opts.dialectClient.client,
      opts.dialectClient.dbType,
      sql,
      opts.explainOptions,
      opts.params
    );

    if (explainReport.degraded && opts.logPrefix) {
      console.warn(
        `[${opts.logPrefix}] EXPLAIN 预检降级放行: ${explainReport.costWarning}`
      );
    }

    if (!explainReport.isValid) {
      throw new Error(
        explainReport.costWarning ||
          `SQL 执行计划语法预检失败: ${explainReport.syntaxError}`
      );
    }

    if (explainReport.exceedsBudget) {
      throw new Error(
        explainReport.costWarning ||
          "SQL 扫描数据行数超过单次查询预算，已触发熔断保护！"
      );
    }
  }

  // 4. 真实下发执行
  const data = await opts.execute();

  // 5. 回写结果集缓存
  opts.cache.set(cacheKey, data, opts.cacheTtlMs);

  return { data, cacheHit: false, explainReport };
}
