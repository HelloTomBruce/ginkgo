import type { DbDialectClient } from "../connectors/db/sqlGuard";
import type { ExplainCostReport, ExplainOptions } from "./types";

const DEFAULT_BUDGET = 1_000_000;

/**
 * 「SQL 本身非法」类错误特征：语法错误、表/列不存在、参数缺失等。
 * 命中 → 拦截查询；未命中（EXPLAIN 变体不受支持、连接/权限等基础设施异常）
 * → 按 RFC §5.3 优雅降级为放行并附告警，避免网关把整个数据源熔断。
 */
const SQL_FAULT_RE =
  /syntax error|parse error|does not exist|unknown (column|table|identifier)|no such (table|column)|undefined (table|column|parameter)|ambiguous|42P01|42P02|42703|ER_(NO_SUCH_TABLE|BAD_FIELD_ERROR|PARSE_ERROR)|1146|1054|1064/i;

/**
 * 递归解析 PostgreSQL JSON 执行计划
 */
function parsePostgresPlan(plan: Record<string, unknown>): {
  totalRows: number;
  hasSeqScan: boolean;
  seqScanTables: string[];
} {
  let totalRows = Number(plan["Plan Rows"] ?? 0);
  let hasSeqScan = plan["Node Type"] === "Seq Scan";
  const seqScanTables: string[] = [];

  if (hasSeqScan && plan["Relation Name"]) {
    seqScanTables.push(String(plan["Relation Name"]));
  }

  const plans = (plan["Plans"] as Record<string, unknown>[]) || [];
  for (const subPlan of plans) {
    const sub = parsePostgresPlan(subPlan);
    totalRows = Math.max(totalRows, sub.totalRows);
    if (sub.hasSeqScan) hasSeqScan = true;
    seqScanTables.push(...sub.seqScanTables);
  }

  return { totalRows, hasSeqScan, seqScanTables };
}

/**
 * 递归解析 MySQL JSON 执行计划
 */
function parseMysqlPlan(obj: unknown): {
  totalRows: number;
  hasAllScan: boolean;
  allScanTables: string[];
} {
  let totalRows = 0;
  let hasAllScan = false;
  const allScanTables: string[] = [];

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;

    if (rec["table"] && typeof rec["table"] === "object") {
      const tableObj = rec["table"] as Record<string, unknown>;
      const rows = Number(tableObj["rows_examined_per_scan"] ?? tableObj["rows"] ?? 0);
      totalRows += rows;
      if (tableObj["access_type"] === "ALL") {
        hasAllScan = true;
        if (tableObj["table_name"]) {
          allScanTables.push(String(tableObj["table_name"]));
        }
      }
    }

    for (const v of Object.values(rec)) {
      if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  }

  walk(obj);
  return { totalRows, hasAllScan, allScanTables };
}

/**
 * 对 SQL 查询执行数仓 Dry-run EXPLAIN 预检，检测语法合法性与扫描预算。
 *
 * params 必须与真实执行一致地绑定到 EXPLAIN——PG 的 `$1` / DuckDB 的 `?`
 * 在未绑定时会让 EXPLAIN 直接报错，把合法参数化查询误判为语法错误。
 */
export async function dryRunExplain(
  client: DbDialectClient,
  dbType: string,
  sql: string,
  options?: ExplainOptions,
  params?: unknown[]
): Promise<ExplainCostReport> {
  const budget = options?.maxScanRowsBudget ?? DEFAULT_BUDGET;
  const blockFullTableScan = options?.blockFullTableScan ?? true;

  const cleanSql = sql.trim().replace(/;+$/, "");

  try {
    let explainSql = "";
    if (dbType === "postgres") {
      explainSql = `EXPLAIN (FORMAT JSON) ${cleanSql}`;
    } else if (dbType === "mysql") {
      explainSql = `EXPLAIN FORMAT=JSON ${cleanSql}`;
    } else if (dbType === "sqlite") {
      explainSql = `EXPLAIN QUERY PLAN ${cleanSql}`;
    } else if (dbType === "duckdb") {
      explainSql = `EXPLAIN ${cleanSql}`;
    } else if (dbType === "clickhouse") {
      explainSql = `EXPLAIN ESTIMATE ${cleanSql}`;
    } else {
      // 默认简单 EXPLAIN
      explainSql = `EXPLAIN ${cleanSql}`;
    }

    const res = await client.query(explainSql, params);
    const rows = res.rows;

    let estimatedRows = 0;
    let isFullTableScan = false;
    let scanTargetDetail = "";

    if (dbType === "postgres" && rows.length > 0) {
      const rawJson = Object.values(rows[0])[0];
      const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
      const planRoot = Array.isArray(parsed) ? parsed[0]?.Plan : parsed?.Plan;
      if (planRoot) {
        const { totalRows, hasSeqScan, seqScanTables } = parsePostgresPlan(planRoot);
        estimatedRows = totalRows;
        isFullTableScan = hasSeqScan && estimatedRows > 5000; // 小表全扫豁免
        if (seqScanTables.length > 0) {
          scanTargetDetail = `（表: ${seqScanTables.join(", ")}）`;
        }
      }
    } else if (dbType === "mysql" && rows.length > 0) {
      const rawJson = Object.values(rows[0])[0];
      const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
      if (parsed) {
        const { totalRows, hasAllScan, allScanTables } = parseMysqlPlan(parsed);
        estimatedRows = totalRows;
        isFullTableScan = hasAllScan && estimatedRows > 5000;
        if (allScanTables.length > 0) {
          scanTargetDetail = `（表: ${allScanTables.join(", ")}）`;
        }
      }
    } else if (dbType === "sqlite") {
      for (const row of rows) {
        const detail = String(row["detail"] || Object.values(row)[0] || "");
        if (detail.includes("SCAN TABLE") && !detail.includes("USING INDEX")) {
          isFullTableScan = true;
          scanTargetDetail = `（${detail}）`;
        }
      }
    } else if (dbType === "duckdb") {
      for (const row of rows) {
        const detail = String(row["explain_value"] || Object.values(row)[0] || "");
        if (detail.includes("SEQ_SCAN")) {
          isFullTableScan = true;
          scanTargetDetail = `（SEQ_SCAN）`;
        }
      }
    } else if (dbType === "clickhouse") {
      for (const row of rows) {
        const line = String(Object.values(row)[0] || "");
        const match = line.match(/rows:\s*(\d+)/i);
        if (match) {
          estimatedRows = Number(match[1]);
        }
      }
    }

    const exceedsBudget = estimatedRows > budget;
    let costWarning: string | undefined;

    if (exceedsBudget) {
      costWarning = `成本门禁拦截：预估扫描行数 (${estimatedRows.toLocaleString()}) 超过安全预算上限 (${budget.toLocaleString()})。请在 SQL 中补充合适的时间分区条件（如 WHERE date >= ...）或增加 LIMIT。`;
    } else if (isFullTableScan && blockFullTableScan && estimatedRows > budget / 2) {
      costWarning = `成本门禁警告：检测到大规模全表扫描风险 ${scanTargetDetail}，预估扫描行数约 ${estimatedRows.toLocaleString()}。建议补充针对索引字段的过滤条件。`;
    }

    return {
      isValid: true,
      estimatedRows,
      isFullTableScan,
      exceedsBudget,
      costWarning,
      planRaw: rows.slice(0, 5),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // SQL 本身非法（语法错误/表列不存在）→ 拦截并回传自愈提示
    if (SQL_FAULT_RE.test(message)) {
      return {
        isValid: false,
        estimatedRows: 0,
        isFullTableScan: false,
        exceedsBudget: false,
        syntaxError: message,
        costWarning: `执行计划预检失败（语法或表/字段不存在）：${message}`,
      };
    }
    // EXPLAIN 能力不可用或基础设施异常 → 优雅降级：放行执行，仅保留只读与行数封顶保护
    return {
      isValid: true,
      estimatedRows: 0,
      isFullTableScan: false,
      exceedsBudget: false,
      degraded: true,
      costWarning: `EXPLAIN 预检不可用，已降级为直接执行（仍受只读与行数封顶保护）：${message}`,
    };
  }
}
