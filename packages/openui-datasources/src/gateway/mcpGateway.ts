import type { DatasourceManager, McpToolBinding } from "../manager";
import { parseMcpToolResult } from "../parseToolResult";
import { QueryCacheManager } from "./queryCache";
import { executeSqlWithGuards } from "./queryPipeline";
import type {
  CatalogOverviewItem,
  ExecuteQueryArgs,
  McpGatewayConfig,
  QueryResultWithMeta,
  TableDetailResource,
} from "./types";

/** 表名标识符白名单：允许 表 / 库.表 两段形态，杜绝经表名插值注入 */
const TABLE_IDENTIFIER_RE = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/;

interface GatewayQueryPayload {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * MCP 连接器网关路由器：
 * - 统一代理数仓与数据源查询，复用共享守卫管线（只读守卫 + 缓存 + EXPLAIN 成本熔断）
 * - 提供两阶段 Schema 懒加载资源接口（Resources)
 *
 * 注意：executeQuery 走 manager.connect 的原始连接执行，刻意绕过 tools 绑定的
 * 守卫拦截——守卫已由共享管线执行一次，避免自我递归与双重 EXPLAIN。
 */
export class McpGateway {
  private cache: QueryCacheManager<GatewayQueryPayload>;
  private manager: DatasourceManager;
  private config: McpGatewayConfig;

  constructor(
    manager: DatasourceManager,
    config?: McpGatewayConfig,
    /** 共享缓存实例：与 manager 工具绑定同一实例，保证失效一致性 */
    sharedCache?: QueryCacheManager<unknown>
  ) {
    this.manager = manager;
    this.config = config ?? {};
    this.cache = (sharedCache ??
      new QueryCacheManager({
        maxEntries: config?.maxCacheEntries,
        defaultTtlMs: config?.defaultCacheTtlMs,
      })) as QueryCacheManager<GatewayQueryPayload>;
  }

  /**
   * 按数据源 ID 与工具原名检索已绑定的工具调用契约
   */
  async getTool(sourceId: string, toolName: string): Promise<McpToolBinding | undefined> {
    const conf = this.manager.get(sourceId);
    if (!conf || conf.enabled === false) return undefined;
    const tools = await this.manager.tools(conf);
    return tools.find((t) => t.originalName === toolName || t.name === `${sourceId}_${toolName}`);
  }

  /**
   * 核心方法：执行 SQL 查询（流经共享守卫管线）
   */
  async executeQuery(args: ExecuteQueryArgs): Promise<QueryResultWithMeta> {
    const { sourceId, sql, params, skipCache, bypassExplain, cacheTtlMs } = args;
    const startTime = Date.now();

    const conf = this.manager.get(sourceId);
    if (!conf || conf.enabled === false) {
      throw new Error(`数据源 [${sourceId}] 未就绪或未启用`);
    }

    const result = await executeSqlWithGuards<GatewayQueryPayload>({
      sourceId,
      sql,
      params,
      skipCache,
      bypassExplain,
      cacheTtlMs,
      dialectClient: this.manager.getDialectClient?.(sourceId),
      cache: this.cache as QueryCacheManager<unknown>,
      explainOptions: this.config.explainOptions,
      logPrefix: `Gateway ${sourceId}`,
      execute: async () => {
        // 工具存在性检查放在执行器内：让管线的只读断言先于一切失败路径
        const toolBinding = await this.getTool(sourceId, "execute_sql");
        if (!toolBinding) {
          throw new Error(`数据源 [${sourceId}] 未暴露 execute_sql 工具接口`);
        }
        // 原始连接直发，绕开 tools 绑定守卫（本管线即守卫，避免递归/双重预检）
        const conn = await this.manager.connect(conf);
        const raw = await conn.callTool("execute_sql", {
          sql,
          ...(params !== undefined ? { params } : {}),
        });
        const parsed = parseMcpToolResult(raw, "MCP tool execute_sql") as
          | { rows?: unknown[]; rowCount?: number }
          | unknown[];

        let rows: Record<string, unknown>[] = [];
        let rowCount = 0;
        if (parsed && typeof parsed === "object") {
          if (!Array.isArray(parsed) && Array.isArray(parsed.rows)) {
            rows = parsed.rows as Record<string, unknown>[];
            rowCount =
              typeof parsed.rowCount === "number" ? parsed.rowCount : rows.length;
          } else if (Array.isArray(parsed)) {
            rows = parsed as Record<string, unknown>[];
            rowCount = rows.length;
          }
        }
        return { rows, rowCount };
      },
    });

    return {
      rows: result.data.rows,
      rowCount: result.data.rowCount,
      cacheHit: result.cacheHit,
      cachedAt: result.cachedAt,
      durationMs: Date.now() - startTime,
      explainReport: result.explainReport,
    };
  }

  /**
   * 两阶段发现第一阶段：获取全量数据源及其表名概览（不含详细字段，防上下文撑爆）
   */
  async listCatalogs(): Promise<CatalogOverviewItem[]> {
    const list = this.manager.list().filter((c) => c.enabled !== false);
    const results: CatalogOverviewItem[] = [];

    for (const item of list) {
      const listTool = await this.getTool(item.id, "list_tables");
      let tables: string[] = [];
      if (listTool) {
        try {
          const res = (await listTool.call({})) as { tables?: unknown[] };
          if (res && Array.isArray(res.tables)) {
            tables = res.tables.map((t: unknown) =>
              typeof t === "string" ? t : String((t as { table?: string })?.table ?? "")
            ).filter(Boolean);
          }
        } catch {
          // 容错降级
          tables = [];
        }
      }

      results.push({
        sourceId: item.id,
        name: item.name,
        type: item.dbType ?? item.kind,
        tables,
      });
    }

    return results;
  }

  /**
   * 两阶段发现第二阶段（Resource）：按需拉取特定表的详细 Schema 与前 3 条样本数据
   */
  async describeTableResource(
    sourceId: string,
    tableName: string
  ): Promise<TableDetailResource> {
    if (!TABLE_IDENTIFIER_RE.test(tableName)) {
      throw new Error(`非法表名标识符: ${tableName}`);
    }

    const describeTool = await this.getTool(sourceId, "describe_table");
    if (!describeTool) {
      throw new Error(`数据源 [${sourceId}] 未提供 describe_table 工具`);
    }

    // 内置 db 源契约为 table_name，第三方 MCP 常见 table；双键下发做容错（服务端忽略多余键）
    const descRes = (await describeTool.call({ table_name: tableName, table: tableName })) as {
      columns?: Array<{ column?: string; name?: string; type?: string; comment?: string }>;
    };
    const columns: TableDetailResource["columns"] = [];

    if (descRes && Array.isArray(descRes.columns)) {
      for (const col of descRes.columns) {
        columns.push({
          name: String(col.column || col.name),
          type: String(col.type || "string"),
          comment: col.comment ? String(col.comment) : undefined,
        });
      }
    }

    // 尝试拉取 3 条样本数据辅助模型理解实际取值
    // tableName 已过白名单校验（仅字母/数字/下划线/$ 与可选 库.表 两段），可安全插值
    let sampleRows: Record<string, unknown>[] = [];
    try {
      const sampleRes = await this.executeQuery({
        sourceId,
        sql: `SELECT * FROM ${tableName} LIMIT 3`,
        skipCache: false,
        bypassExplain: true,
      });
      sampleRows = sampleRes.rows;
    } catch {
      sampleRows = [];
    }

    return {
      sourceId,
      tableName,
      columns,
      sampleRows,
    };
  }

  /**
   * 清除网关缓存（共享实例时等同清除该源的全部缓存）
   */
  invalidateCache(sourceId?: string): void {
    this.cache.invalidate(sourceId);
  }

  getCacheManager(): QueryCacheManager<GatewayQueryPayload> {
    return this.cache;
  }
}
