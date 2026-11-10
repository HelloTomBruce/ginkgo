/**
 * 活看板刷新引擎（P2-A 第二步）：查询重放 + 数据回填，全程零 LLM 调用。
 *
 * server-only：经 datasource 网关连接源重放（sqlGuard 只读守卫 + dbMcpServer
 * 引擎级只读/超时/行数封顶自动继承）；DSL 解析/序列化用 serverLibrary（与
 * prompt schema 同源），保证回填后的 dsl 仍可被前端渲染器解析。
 *
 * 网关注入（RefreshGateway）使重放逻辑可单测；应用侧路由传 datasources 单例。
 * 设计见 DocMind「看板留存与分享」M3b 段。
 */
import type {
  DynamicSourceConfig,
  McpConnection,
} from "@openui-analytics/datasources";
import { assertReadOnlySql } from "@openui-analytics/datasources/sqlGuard";
import { parseMcpToolResult } from "@openui-analytics/datasources/parseToolResult";
import {
  createParser,
  jsonToOpenUI,
  serverLibrary,
} from "@openui-analytics/llm/serverLibrary";
import { extractQueryRows, rowPropFor } from "./queryRows";
import { materializeSpecRows } from "./specMaterialize";
import { parseChartSpec, type ChartSpec } from "@openui-analytics/chart-spec";
import {
  applyTransform,
  isValidTransformSpec,
  type TransformSpec,
} from "./transforms";
import type { DashboardRecord, DashboardQuery } from "./dashboardStore";

/** 数据源网关（datasource manager 的结构子集，便于测试注入） */
export interface RefreshGateway {
  get(id: string): DynamicSourceConfig | undefined;
  connect(source: DynamicSourceConfig): Promise<McpConnection>;
}

export type RefreshVerdict =
  | { ok: true; dsl: string; stale: string[] }
  | {
      ok: false;
      reason: "readonly" | "dsl-invalid" | "replay-failed";
      error: string;
    }
  | {
      ok: false;
      reason: "source-unavailable";
      error: string;
      sourceId: string;
    };

/** 解析器单例：schema 与 prompt/前端渲染器同源 */
const parser = createParser(serverLibrary.toJSONSchema(), "Root");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 服务端只读重放白名单（安全边界）：queries 落盘自不可信的客户端工具调用记录，
 * 重放前必须在服务端复核「该工具确实是只读的」，否则刷新端点会退化为
 * 零 LLM 的写操作原语（被篡改的落盘记录可直接触发任意工具调用）。
 * - db 类网关读工具：天然只读
 * - 读语义工具名（get/list/search/... 前缀）：GitLab 等 http-mcp 的只读面
 * - 禅道 CLI 工具（zentao_*）：工具本身带写动作，按 args.action 放行只读动作
 * 未命中白名单 → 该查询拒绝重放（组件 stale），并留告警日志。
 */
const READONLY_GATEWAY_TOOLS = new Set(["execute_sql", "list_tables", "describe_table"]);
const READONLY_TOOL_PREFIX =
  /^(get|list|search|describe|my|read|fetch|find|diff|blame|health|help|version|whoami|mr_discussions)/;
const READONLY_ZENTAO_ACTIONS = new Set(["list", "get", "modules", "search", "profile"]);
const READONLY_ZENTAO_TOOLS = new Set(["zentao_my", "zentao_profile"]);

function isReplayableTool(tool: string, args: Record<string, unknown>): boolean {
  if (READONLY_GATEWAY_TOOLS.has(tool)) return true;
  if (tool.startsWith("zentao_")) {
    if (READONLY_ZENTAO_TOOLS.has(tool)) return true;
    const action = args.action;
    return typeof action === "string" && READONLY_ZENTAO_ACTIONS.has(action);
  }
  return READONLY_TOOL_PREFIX.test(tool);
}

/**
 * 单查询重放：成功返回行数组，失败返回 null（调用方按 stale 降级）。
 * - kind=sql：词法守卫快失败 + dbMcpServer execute_sql（只读事务/超时/行封顶）
 * - kind=tool：payload {tool,args} JSON → 只读白名单复核 → 同源连接 callTool
 * 失败不静默：服务端 console.warn 留痕（基础设施故障与「无数据」必须可区分）。
 */
async function replayQuery(
  query: DashboardQuery,
  conn: McpConnection
): Promise<Record<string, unknown>[] | null> {
  try {
    if (query.kind === "sql") {
      assertReadOnlySql(query.payload);
      const res = await conn.callTool("execute_sql", { sql: query.payload });
      return extractQueryRows(parseMcpToolResult(res, `刷新重放 ${query.id}`));
    }
    const parsed: unknown = JSON.parse(query.payload);
    if (
      !isPlainObject(parsed) ||
      typeof parsed.tool !== "string" ||
      !parsed.tool
    ) {
      console.warn(`[dashboardRefresh] 查询 ${query.id} payload 非法，跳过重放`);
      return null;
    }
    const args = isPlainObject(parsed.args) ? parsed.args : {};
    // 只读白名单复核：未命中 → 拒绝重放（不触达源），组件按 stale 降级
    if (!isReplayableTool(parsed.tool, args)) {
      console.warn(
        `[dashboardRefresh] 查询 ${query.id} 工具 "${parsed.tool}" 不在只读白名单，拒绝重放`
      );
      return null;
    }
    const res = await conn.callTool(parsed.tool, args);
    return extractQueryRows(parseMcpToolResult(res, `刷新重放 ${query.id}`));
  } catch (err: unknown) {
    console.warn(
      `[dashboardRefresh] 查询 ${query.id} 重放失败:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

interface ElementLike {
  type?: unknown;
  statementId?: unknown;
  typeName?: unknown;
  props?: unknown;
}

/** 递归遍历元素树，按 bindings 回填行数组（带 transform 的先重算）；返回仍过期（未刷新成功）的组件 */
function backfillElements(
  root: unknown,
  bindings: Record<string, string>,
  transforms: Record<string, TransformSpec> | undefined,
  rowsByQueryId: Map<string, Record<string, unknown>[] | null>
): string[] {
  const stale: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as ElementLike;
    if (node.type === "element") {
      const statementId =
        typeof node.statementId === "string" ? node.statementId : undefined;
      if (statementId && Object.prototype.hasOwnProperty.call(bindings, statementId)) {
        const queryId = bindings[statementId];
        const rows = rowsByQueryId.get(queryId);
        const prop =
          typeof node.typeName === "string" ? rowPropFor(node.typeName) : undefined;
        // transform 绑定：重放结果按 spec 重算（spec 落盘自客户端，
        // 刷新前复核形态——与只读白名单同一不信任哲学）
        const spec = transforms?.[statementId];
        const specValid = spec === undefined || isValidTransformSpec(spec);
        if (
          rows &&
          prop &&
          isPlainObject(node.props) &&
          Array.isArray(node.props[prop]) &&
          specValid
        ) {
          node.props[prop] = spec ? applyTransform(rows, spec) : rows;
        } else {
          // 查询重放失败 / 组件类型不持行数组 / prop 形态或 spec 异常 → 保留旧数据
          stale.push(statementId);
        }
      }
    }
    // 深入 props 与数组容器寻找子组件节点
    if (isPlainObject(node.props)) {
      for (const v of Object.values(node.props)) walk(v);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v);
    }
  };
  walk(root);
  return stale;
}

/** SpecChart 声明节点：spec 物化的回填目标（保留节点引用以便就地写 data） */
interface SpecNode {
  statementId: string;
  spec: ChartSpec;
  table: string | undefined;
  props: Record<string, unknown>;
  /** spec.sourceId 缺省时经 defaultSourceId 解析，仍缺省则节点过期 */
  resolvedSourceId: string | undefined;
}

/** 收集 DSL 中的 SpecChart 声明节点（spec 形态非法的节点不入列，按 stale 降级） */
function collectSpecNodes(
  root: unknown,
  defaultSourceId: string | undefined
): { nodes: SpecNode[]; invalidIds: string[] } {
  const nodes: SpecNode[] = [];
  const invalidIds: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as {
      type?: unknown;
      statementId?: unknown;
      typeName?: unknown;
      props?: unknown;
    };
    if (node.type === "element" && node.typeName === "SpecChart" && isPlainObject(node.props)) {
      const statementId =
        typeof node.statementId === "string" ? node.statementId : undefined;
      const spec = parseChartSpec(node.props.spec);
      const table =
        typeof node.props.table === "string" && node.props.table ? node.props.table : undefined;
      if (statementId && spec) {
        nodes.push({
          statementId,
          spec,
          table,
          props: node.props,
          resolvedSourceId: spec.sourceId ?? defaultSourceId,
        });
      } else if (statementId) {
        invalidIds.push(statementId);
      }
    }
    if (isPlainObject(node.props)) {
      for (const v of Object.values(node.props)) walk(v);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v);
    }
  };
  walk(root);
  return { nodes, invalidIds };
}

/**
 * 刷新主入口：重放 record.queries → 回填 dsl 组件 → 序列化新 dsl。
 * - record 无 queries 且无 SpecChart 声明（v0.1 旧快照）→ readonly
 * - 源不存在/停用/连接失败 → source-unavailable（整体失败，调用方附重新分析引导）
 * - 单查询失败仅影响其绑定组件（stale），其余组件正常刷新
 * - SpecChart：按声明 spec 物化（materializeSpecRows）回填 data，sourceId
 *   缺省时用 defaultSourceId（调用方在「仅一个激活源」时传入）
 */
export async function refreshDashboard(
  record: DashboardRecord,
  gateway: RefreshGateway,
  defaultSourceId?: string
): Promise<RefreshVerdict> {
  const queries = record.queries ?? [];

  // 解析前置：SpecChart 声明节点决定「是否可刷新」与源集合
  let parsed: ReturnType<typeof parser.parse>;
  try {
    parsed = parser.parse(record.dsl);
  } catch {
    if (queries.length === 0) {
      return {
        ok: false,
        reason: "readonly",
        error: "该看板为静态快照（无查询绑定），不支持数据刷新；可基于原提问重新分析生成可刷新看板",
      };
    }
    return {
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 解析失败，无法回填数据；建议重新分析",
    };
  }
  if (!parsed.root) {
    if (queries.length === 0) {
      return {
        ok: false,
        reason: "readonly",
        error: "该看板为静态快照（无查询绑定），不支持数据刷新；可基于原提问重新分析生成可刷新看板",
      };
    }
    return {
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 解析失败，无法回填数据；建议重新分析",
    };
  }
  const { nodes: specNodes, invalidIds } = collectSpecNodes(parsed.root, defaultSourceId);

  if (queries.length === 0 && specNodes.length === 0) {
    return {
      ok: false,
      reason: "readonly",
      error: "该看板为静态快照（无查询绑定），不支持数据刷新；可基于原提问重新分析生成可刷新看板",
    };
  }

  // 源预检：任一查询/声明的源缺失/停用 → 整体失败（不做部分刷新的半吊子状态）。
  // SpecChart 缺省源（未声明 sourceId 且无 defaultSourceId）不整体失败，
  // 仅该节点按 stale 降级。
  const sourceIds = [
    ...new Set([
      ...queries.map((q) => q.sourceId),
      ...specNodes.map((n) => n.resolvedSourceId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  for (const sourceId of sourceIds) {
    const conf = gateway.get(sourceId);
    if (!conf || conf.enabled === false) {
      return {
        ok: false,
        reason: "source-unavailable",
        error: `数据源不可用: ${sourceId}（不存在或已停用）；建议基于原提问重新分析`,
        sourceId,
      };
    }
  }

  // 按源分组重放：同源共用一条连接；连接失败 = 源不可用（整体失败）
  const rowsByQueryId = new Map<string, Record<string, unknown>[] | null>();
  const connections = new Map<string, McpConnection>();
  try {
    for (const sourceId of sourceIds) {
      const conf = gateway.get(sourceId) as DynamicSourceConfig;
      let conn: McpConnection;
      try {
        conn = await gateway.connect(conf);
      } catch {
        return {
          ok: false,
          reason: "source-unavailable",
          error: `数据源连接失败: ${sourceId}；建议基于原提问重新分析`,
          sourceId,
        };
      }
      connections.set(sourceId, conn);
    }
    for (const query of queries) {
      const conn = connections.get(query.sourceId) as McpConnection;
      rowsByQueryId.set(query.id, await replayQuery(query, conn));
    }
  } finally {
    // 刷新用连接来自 manager 缓存（getOrConnectEntry 语义），生命周期归 manager
    // 管理，这里不主动 close——避免打断其他并发使用者
  }

  // SpecChart 物化：按声明 spec 取数（零 LLM），就地写回 node.props.data。
  // 节点级失败（缺表名/缺源/物化失败）→ stale，不影响其他组件。
  let specOkCount = 0;
  const specStale: string[] = [];
  for (const node of specNodes) {
    const sourceId = node.resolvedSourceId;
    if (!sourceId || !node.table) {
      specStale.push(node.statementId);
      continue;
    }
    const conn = connections.get(sourceId);
    const conf = gateway.get(sourceId) as DynamicSourceConfig;
    if (!conn || !conf) {
      specStale.push(node.statementId);
      continue;
    }
    const verdict = await materializeSpecRows(conn, conf, sourceId, node.spec, node.table);
    if (verdict.ok) {
      node.props.data = verdict.rows;
      specOkCount++;
    } else {
      console.warn(
        `[dashboardRefresh] SpecChart ${node.statementId} 物化失败 (${verdict.reason}):`,
        verdict.detail ?? verdict.missing?.join(",") ?? ""
      );
      specStale.push(node.statementId);
    }
  }

  // 全部数据通道失败：无任何新数据可回填，落盘只会带来无意义的 DSL 重写
  // （解析/序列化归一可能静默改动字节）→ 整体失败，保留原记录不动
  const queryAllFailed =
    queries.length === 0 || queries.every((q) => rowsByQueryId.get(q.id) === null);
  const specAllFailed =
    specNodes.length === 0 || specOkCount === 0;
  if (queryAllFailed && specAllFailed) {
    return {
      ok: false,
      reason: "replay-failed",
      error: "全部取数查询重放失败（源异常或查询已失效），看板数据保持原样；建议基于原提问重新分析",
    };
  }

  // 回填：按 bindings 替换行数组（DSL 已在入口解析）
  const stale = [
    ...backfillElements(
      parsed.root,
      record.bindings ?? {},
      record.transforms,
      rowsByQueryId
    ),
    ...specStale,
    ...invalidIds,
  ];
  let dsl: string;
  try {
    dsl = jsonToOpenUI(parsed.root, serverLibrary);
  } catch {
    return {
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 序列化失败，无法回填数据；建议重新分析",
    };
  }

  return { ok: true, dsl, stale };
}
