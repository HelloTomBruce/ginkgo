/**
 * 字段去重值拉取（M2 筛选联动第一步，server-only）：FilterBar 声明式选项的数据源。
 *
 * GET distinct 经 db 源参数化 SELECT DISTINCT（只读守卫 + 行封顶继承 dbMcpServer），
 * 200 条封顶 + 超限哨兵（truncated 标记让前端退化为输入框）；模块级 TTL 缓存
 * （源 id+field+table 为键，5 分钟）防 distinct 压源。
 *
 * 非 db 源（http-mcp/stdio-cli/file）返回 unsupported——调用方退化为自由输入，
 * M3 评估按连接器能力扩展。
 */
import type { DynamicSourceConfig, McpConnection } from "@ginkgo/datasources";
import { parseMcpToolResult } from "@ginkgo/datasources/parseToolResult";
import { SOURCE_ID_RE } from "@ginkgo/chart-spec";
import { extractQueryRows } from "@ginkgo/app-analytics/isomorphic";
import { TABLE_RE } from "./specMaterialize";

export const DISTINCT_VALUES_CAP = 200;
export const DISTINCT_TTL_MS = 5 * 60 * 1000;

export interface DistinctCacheEntry {
  values: string[];
  truncated: boolean;
  at: number;
}

// 模块级缓存：进程生命周期内复用（与 dashboardStore 单文件哲学一致，无需持久化）
const cache = new Map<string, DistinctCacheEntry>();

export function clearDistinctCache(): void {
  cache.clear();
}

export type DistinctVerdict =
  | { ok: true; values: string[]; truncated: boolean; cached: boolean }
  | {
      ok: false;
      reason: "invalid-params" | "source-unavailable" | "unsupported" | "query-failed";
      detail?: string;
    };

/** 数据源网关（datasource manager 的结构子集，便于测试注入） */
export interface DistinctGateway {
  get(id: string): DynamicSourceConfig | undefined;
  connect(source: DynamicSourceConfig): Promise<McpConnection>;
}

function isValidParams(
  sourceId: string,
  field: string,
  table: string
): boolean {
  return (
    SOURCE_ID_RE.test(sourceId) &&
    /^[A-Za-z_$][\w$]{0,63}$/.test(field) &&
    TABLE_RE.test(table)
  );
}

/**
 * 拉取字段去重值（带 TTL 缓存）。ttlMs 供测试注入（0 = 永不过期语义反转：
 * 每次都重新拉取）。
 */
export async function getDistinctValues(
  gateway: DistinctGateway,
  sourceId: string,
  field: string,
  table: string,
  opts?: { ttlMs?: number }
): Promise<DistinctVerdict> {
  if (!isValidParams(sourceId, field, table)) {
    return { ok: false, reason: "invalid-params", detail: `${sourceId}/${field}/${table}` };
  }
  const ttlMs = opts?.ttlMs ?? DISTINCT_TTL_MS;
  const key = `${sourceId}\u0000${field}\u0000${table}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    return { ok: true, values: hit.values, truncated: hit.truncated, cached: true };
  }

  const source = gateway.get(sourceId);
  if (!source || source.enabled === false) {
    return { ok: false, reason: "source-unavailable", detail: sourceId };
  }
  if (source.kind !== "db") {
    return {
      ok: false,
      reason: "unsupported",
      detail: `源类型 ${source.kind} 暂不支持 distinct 拉取，请使用自由输入`,
    };
  }

  let conn: McpConnection;
  try {
    conn = await gateway.connect(source);
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "source-unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // LIMIT 201 = 200 条 + 1 哨兵：>200 即 truncated（前端退化为输入框）
  const sql = `SELECT DISTINCT ${field} AS ${field} FROM ${table} ORDER BY ${field} LIMIT ${
    DISTINCT_VALUES_CAP + 1
  }`;
  try {
    const res = await conn.callTool("execute_sql", { sql });
    const parsed = parseMcpToolResult(res, `distinct ${sourceId}/${field}`);
    const rows = extractQueryRows(parsed);
    if (!rows) {
      return { ok: false, reason: "query-failed", detail: "结果不含行数组" };
    }
    const truncated = rows.length > DISTINCT_VALUES_CAP;
    const values = rows
      .slice(0, DISTINCT_VALUES_CAP)
      .map((r) => String(r[field] ?? ""))
      .filter((v) => v !== "");
    const entry: DistinctCacheEntry = { values, truncated, at: Date.now() };
    cache.set(key, entry);
    return { ok: true, values, truncated, cached: false };
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "query-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
