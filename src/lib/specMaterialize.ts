/**
 * ChartSpec 物化管线（M1 SQL 通道，server-only 执行 + isomorphic 纯构建）。
 *
 * 借鉴 DataEase 数据 tab：spec 声明「维度×指标×过滤」，本模块把它编译为
 * 参数化 SQL（GROUP BY dims / 聚合 meas / WHERE filters），经 dbMcpServer
 * execute_sql（只读事务/超时/行封顶）执行并回填行数组。
 *
 * 安全边界（封闭词汇表，无自由文本拼接）：
 * - 表名/字段名走正则白名单（标识符形态），不进参数位
 * - 过滤值全部参数绑定（? / clickhouse {pN}），值不经字符串拼接
 * - ORDER BY 键只能是输出别名（白名单内），LIMIT 与引擎默认封顶取 min
 * - 时间粒度按方言编译（date_trunc / DATE_FORMAT / strftime / dateTrunc）
 * - 非 db 源走 TransformSpec 退化通道（M3）：spec.toolQuery 声明取数工具 →
 *   原始行 → filters 行级谓词 → dims/meas 聚合重算（applyTransform）；
 *   未声明 toolQuery 的 MCP 源明确报 mcp-unsupported
 */
import {
  specToGroupByAndMetrics,
  type ChartSpec,
  FIELD_RE,
  SOURCE_ID_RE,
} from "@openui-analytics/chart-spec";
import {
  type McpConnection,
} from "@openui-analytics/datasources";
import { parseMcpToolResult } from "@openui-analytics/datasources/parseToolResult";
import { extractQueryRows } from "./queryRows";
import {
  applyTransform,
  isValidTransformSpec,
  type TransformSpec,
} from "./transforms";

// ===== 常量与标识符规则 =====

/** 结果行硬上限：与 sqlGuard enforceRowLimit 引擎默认封顶（200）一致——
 * 我们显式发出 LIMIT 时引擎不会再补封顶，必须在此自封 */
export const SPEC_ROW_CAP = 200;

/** 表名白名单：schema.table 最多两段（标识符形态，正则即转义） */
export const TABLE_RE = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*){0,2}$/;

export type DbType = "postgres" | "mysql" | "sqlite" | "clickhouse";

function assertIdentifier(name: string, label: string): string {
  if (!FIELD_RE.test(name)) {
    throw new Error(`非法${label}标识符: ${JSON.stringify(name)}`);
  }
  return name;
}

/** 占位符风格：clickhouse 只支持命名参数 {pN}，其余方言匿名 ? */
function placeholder(dbType: DbType, index: number): string {
  return dbType === "clickhouse" ? `{p${index}}` : "?";
}

// ===== 时间粒度编译（按方言）=====

/**
 * 时间维度截断表达式。返回 null 表示该 方言×粒度 组合不支持
 * （调用方转为明确报错而非静默降级）。
 */
export function granularityExpr(
  field: string,
  granularity: NonNullable<ChartSpec["dims"][number]["granularity"]>,
  dbType: DbType
): string | null {
  switch (dbType) {
    case "postgres":
      return `date_trunc('${granularity}', ${field})`;
    case "clickhouse":
      return `dateTrunc('${granularity}', ${field})`;
    case "sqlite":
      switch (granularity) {
        case "day":
          return `strftime('%Y-%m-%d', ${field})`;
        case "week":
          return `strftime('%Y-%W', ${field})`;
        case "month":
          return `strftime('%Y-%m-01', ${field})`;
        case "quarter":
          return `(strftime('%Y', ${field}) || '-Q' || (CAST(strftime('%m', ${field}) AS INTEGER) + 2) / 3)`;
        case "year":
          return `strftime('%Y-01-01', ${field})`;
      }
      return null;
    case "mysql":
      switch (granularity) {
        case "day":
          return `DATE(${field})`;
        case "week":
          return `DATE_FORMAT(${field}, '%x-%v-01')`;
        case "month":
          return `DATE_FORMAT(${field}, '%Y-%m-01')`;
        case "quarter":
          return `CONCAT(YEAR(${field}), '-Q', QUARTER(${field}))`;
        case "year":
          return `DATE_FORMAT(${field}, '%Y-01-01')`;
      }
      return null;
  }
}

// ===== SQL 构建（纯函数，可快照测试）=====

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  /** 输出列别名 → 原始字段（回填/校验用） */
  outputAliases: Map<string, string>;
}

export interface BuildQueryOptions {
  /** 数据表（schema.table 允许，正则白名单） */
  table: string;
  dbType: DbType;
}

/**
 * ChartSpec → 参数化聚合 SQL。
 * SELECT 维度表达式+聚合指标 → WHERE 参数化过滤 → GROUP BY 表达式 →
 * ORDER BY 输出别名 → LIMIT 封顶。
 */
export function buildSpecQuery(
  spec: ChartSpec,
  opts: BuildQueryOptions
): BuiltQuery {
  if (!TABLE_RE.test(opts.table)) {
    throw new Error(`非法表名标识符: ${JSON.stringify(opts.table)}`);
  }

  const params: unknown[] = [];
  const param = (value: unknown): string => {
    params.push(value);
    return placeholder(opts.dbType, params.length - 1);
  };

  // --- SELECT 子句（别名 = 白名单标识符，免引号跨方言）---
  const selectParts: string[] = [];
  const groupParts: string[] = [];
  const outputAliases = new Map<string, string>();
  const taken = new Set<string>();

  const takeAlias = (base: string): string => {
    let alias = base;
    let n = 2;
    while (taken.has(alias)) alias = `${base}_${n++}`;
    taken.add(alias);
    return alias;
  };

  for (const dim of spec.dims) {
    const field = assertIdentifier(dim.field, "维度字段");
    if (dim.granularity) {
      const expr = granularityExpr(field, dim.granularity, opts.dbType);
      if (!expr) {
        throw new Error(
          `方言 ${opts.dbType} 不支持时间粒度 ${dim.granularity}`
        );
      }
      const alias = takeAlias(`${field}_${dim.granularity}`);
      selectParts.push(`${expr} AS ${alias}`);
      groupParts.push(expr);
      outputAliases.set(alias, field);
    } else {
      const alias = takeAlias(field);
      selectParts.push(`${field} AS ${alias}`);
      groupParts.push(field);
      outputAliases.set(alias, field);
    }
  }

  for (const m of spec.meas) {
    const field = assertIdentifier(m.field, "指标字段");
    const alias = takeAlias(field);
    selectParts.push(`${m.agg.toUpperCase()}(${field}) AS ${alias}`);
    outputAliases.set(alias, field);
  }

  // --- WHERE 子句（值全参数化；LIKE 值做通配符转义）---
  const whereParts: string[] = [];
  for (const f of spec.filters ?? []) {
    const field = assertIdentifier(f.field, "过滤字段");
    switch (f.op) {
      case "eq":
        whereParts.push(`${field} = ${param(f.value)}`);
        break;
      case "ne":
        whereParts.push(`${field} <> ${param(f.value)}`);
        break;
      case "gt":
        whereParts.push(`${field} > ${param(f.value)}`);
        break;
      case "gte":
        whereParts.push(`${field} >= ${param(f.value)}`);
        break;
      case "lt":
        whereParts.push(`${field} < ${param(f.value)}`);
        break;
      case "lte":
        whereParts.push(`${field} <= ${param(f.value)}`);
        break;
      case "in": {
        const values = f.value as string[];
        const ph = values.map((v) => param(v)).join(", ");
        whereParts.push(`${field} IN (${ph})`);
        break;
      }
      case "between": {
        const [lo, hi] = f.value as [number, number];
        whereParts.push(`${field} BETWEEN ${param(lo)} AND ${param(hi)}`);
        break;
      }
      case "contains": {
        // 用户值中的 % _ \ 转义为字面量（clickhouse 原生 \ 转义，无需 ESCAPE 子句）
        const raw = f.value as string;
        const escaped = raw.replace(/[\\%_]/g, "\\$&");
        const escapeClause = opts.dbType === "clickhouse" ? "" : " ESCAPE '\\'";
        whereParts.push(
          `${field} LIKE ${param(`%${escaped}%`)}${escapeClause}`
        );
        break;
      }
    }
  }

  // --- ORDER BY（仅允许输出别名）---
  let orderBy = "";
  if (spec.sort) {
    if (!outputAliases.has(spec.sort.key)) {
      throw new Error(
        `排序键必须是输出别名（维度/指标列），收到: ${JSON.stringify(spec.sort.key)}`
      );
    }
    orderBy = `\nORDER BY ${spec.sort.key} ${spec.sort.desc ? "DESC" : "ASC"}`;
  }

  // --- LIMIT（与引擎默认封顶取 min）---
  const limit = Math.min(spec.limit ?? SPEC_ROW_CAP, SPEC_ROW_CAP);

  const lines = [
    `SELECT ${selectParts.join(", ")}`,
    `FROM ${opts.table}`,
    whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "",
    groupParts.length > 0 ? `GROUP BY ${groupParts.join(", ")}` : "",
    orderBy,
    `LIMIT ${limit}`,
  ].filter(Boolean);

  return { sql: lines.join("\n"), params, outputAliases };
}

// ===== MCP 退化通道（非 db 源）=====

/** 数字化比较（数字与数字字符串互认） */
function asNumberOr(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * spec.filters → 行级谓词（MCP 通道：无法下推工具参数的过滤在行上执行）。
 * op 词汇与 ChartSpecSchema 一致；数值比较容忍数字字符串。
 */
export function rowMatchesSpecFilter(
  row: Record<string, unknown>,
  filter: { field: string; op: string; value: unknown }
): boolean {
  const cell = row[filter.field];
  switch (filter.op) {
    case "eq":
      return cell === filter.value || String(cell) === String(filter.value);
    case "ne":
      return !(cell === filter.value || String(cell) === String(filter.value));
    case "in": {
      const list = filter.value as string[];
      return list.some(
        (v) => cell === v || String(cell) === String(v)
      );
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumberOr(cell);
      const b = asNumberOr(filter.value);
      if (a === null || b === null) return false;
      if (filter.op === "gt") return a > b;
      if (filter.op === "gte") return a >= b;
      if (filter.op === "lt") return a < b;
      return a <= b;
    }
    case "between": {
      const a = asNumberOr(cell);
      const [lo, hi] = filter.value as [number, number];
      return a !== null && a >= lo && a <= hi;
    }
    case "contains":
      return String(cell ?? "").includes(String(filter.value));
    default:
      return false;
  }
}

/** 全部 filters 通过才放行 */
export function rowPassesSpecFilters(
  row: Record<string, unknown>,
  filters: readonly { field: string; op: string; value: unknown }[] | undefined
): boolean {
  for (const f of filters ?? []) {
    if (!rowMatchesSpecFilter(row, f)) return false;
  }
  return true;
}

/**
 * ChartSpec → TransformSpec 投影（MCP 退化通道）：
 * dims→groupBy、meas field→agg、sort/limit 透传（limit 与 SPEC_ROW_CAP 取 min）。
 */
export function specToTransformSpec(spec: ChartSpec): TransformSpec {
  const { groupBy, metrics } = specToGroupByAndMetrics(spec);
  const known = new Set<string>([...groupBy, ...Object.keys(metrics)]);
  let sort: TransformSpec["sort"];
  if (spec.sort) {
    if (!known.has(spec.sort.key)) {
      throw new Error(
        `排序键必须是维度/指标字段，收到: ${JSON.stringify(spec.sort.key)}`
      );
    }
    sort = { key: spec.sort.key, desc: spec.sort.desc };
  }
  return {
    op: "aggregate",
    groupBy,
    metrics,
    ...(sort ? { sort } : {}),
    limit: Math.min(spec.limit ?? SPEC_ROW_CAP, SPEC_ROW_CAP),
  };
}

// ===== 字段存在性校验 =====

export interface ColumnInfo {
  column: string;
  type: string;
}

/**
 * 按 describe_table 结果校验 spec 引用的全部字段存在
 * （dims/meas/filters/sort/thresholds），幻觉字段在此明确报错。
 */
export function validateSpecFields(
  spec: ChartSpec,
  columns: ColumnInfo[]
): { ok: true } | { ok: false; missing: string[] } {
  const known = new Set(columns.map((c) => c.column));
  const referenced = new Set<string>();
  for (const d of spec.dims) referenced.add(d.field);
  for (const m of spec.meas) referenced.add(m.field);
  for (const f of spec.filters ?? []) referenced.add(f.field);
  for (const t of spec.style?.thresholds ?? []) referenced.add(t.when.field);
  // 排序键引用输出别名（可能是粒度派生列，如 day_month，源 schema 必然没有），
  // 仅当它不是任何输出别名时才按源字段校验（buildSpecQuery 另有别名白名单硬校验）
  if (spec.sort) {
    const aliases = new Set<string>([
      ...spec.dims.map((d) => (d.granularity ? `${d.field}_${d.granularity}` : d.field)),
      ...spec.meas.map((m) => m.field),
    ]);
    if (!aliases.has(spec.sort.key)) referenced.add(spec.sort.key);
  }
  const missing = [...referenced].filter((f) => !known.has(f));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ===== 执行（server-only）=====

/** 执行来源信息（DynamicSourceConfig 的结构子集，便于测试注入） */
export interface SpecSourceInfo {
  kind: string;
  dbType?: string;
}

export type SpecMaterializeVerdict =
  | { ok: true; rows: Record<string, unknown>[]; sql: string }
  | {
      ok: false;
      reason:
        | "mcp-unsupported" // 非 db 源且未声明 spec.toolQuery
        | "field-missing" // 幻觉字段，明确报错
        | "invalid-source-id" // sourceId 不合规则
        | "replay-failed"; // 执行失败（引擎/守卫/解析）
      detail?: string;
      missing?: string[];
    };

/**
 * 物化执行：构建 SQL → describe_table 校验字段 → execute_sql 执行 → 行提取。
 * 连接由调用方建立（与 dashboardRefresh 的 gateway/connect 模式一致）。
 */
export async function materializeSpecRows(
  conn: McpConnection,
  source: SpecSourceInfo,
  sourceId: string | undefined,
  spec: ChartSpec,
  table: string
): Promise<SpecMaterializeVerdict> {
  if (typeof sourceId === "string" && !SOURCE_ID_RE.test(sourceId)) {
    return { ok: false, reason: "invalid-source-id", detail: sourceId };
  }
  if (source.kind !== "db" || !source.dbType) {
    // ===== MCP 退化通道（M3）：toolQuery 声明取数 → 行谓词 → TransformSpec 聚合 =====
    const toolQuery = spec.toolQuery;
    if (!toolQuery || typeof toolQuery.tool !== "string" || !toolQuery.tool) {
      return {
        ok: false,
        reason: "mcp-unsupported",
        detail: `源类型 ${source.kind} 需在 spec.toolQuery 声明取数工具（tool+args）`,
      };
    }
    try {
      const res = await conn.callTool(toolQuery.tool, toolQuery.args ?? {});
      const parsed = parseMcpToolResult(res, `specMaterialize tool ${toolQuery.tool}`);
      const raw = extractQueryRows(parsed);
      if (!raw) {
        return { ok: false, reason: "replay-failed", detail: "工具结果不含行数组" };
      }
      const filtered = raw.filter((row) => rowPassesSpecFilters(row, spec.filters));
      const spec2 = specToTransformSpec(spec);
      if (!isValidTransformSpec(spec2)) {
        return { ok: false, reason: "replay-failed", detail: "TransformSpec 投影非法" };
      }
      const aggregated = applyTransform(filtered, spec2);
      return { ok: true, rows: aggregated, sql: `(mcp) ${toolQuery.tool}` };
    } catch (err: unknown) {
      return {
        ok: false,
        reason: "replay-failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const dbType = source.dbType as DbType;

  let built: BuiltQuery;
  try {
    built = buildSpecQuery(spec, { table, dbType });
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "replay-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 字段存在性校验（幻觉字段防护）：describe_table 结果驱动
  try {
    const res = await conn.callTool("describe_table", { table_name: table });
    const columns = parseMcpToolResult(res, "specMaterialize describe_table");
    const rows = extractQueryRows(columns);
    if (rows) {
      const colInfo = rows
        .map((r) => ({ column: String(r.column ?? ""), type: String(r.type ?? "") }))
        .filter((c) => c.column);
      const check = validateSpecFields(spec, colInfo);
      if (!check.ok) {
        return { ok: false, reason: "field-missing", missing: check.missing };
      }
    }
    // describe 失败/形态不符不阻断执行——引擎侧仍会给出明确 SQL 错误
  } catch {
    // 同上：字段校验是尽力防护，不作为硬前置（部分源可能无该表目录权限）
  }

  try {
    const res = await conn.callTool("execute_sql", {
      sql: built.sql,
      params: built.params,
    });
    const parsed = parseMcpToolResult(res, "specMaterialize execute_sql");
    const rows = extractQueryRows(parsed);
    if (!rows) {
      return { ok: false, reason: "replay-failed", detail: "结果不含行数组" };
    }
    return { ok: true, rows, sql: built.sql };
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "replay-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
