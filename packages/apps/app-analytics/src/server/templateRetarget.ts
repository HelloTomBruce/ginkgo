/**
 * 模板重绑定（M3 资产层，server-only 执行 + isomorphic 纯函数）：
 * 借鉴 DataEase 模板中心「换数据集即用」——template 记录的取数声明整体
 * 指向新数据源，产出新看板草稿（不落盘；落盘由调用方走创建链路）。
 *
 * 覆盖面（与活看板刷新同源的字段）：
 * - queries[].sourceId 全量替换
 * - SpecChart 声明节点的 spec.sourceId 替换（toolQuery 原样保留——工具名与源无关）
 * - bindings 仅 statementId→queryId 映射，不含源信息，原样保留
 * - sourceNames 归档快照替换为目标源名称
 *
 * 校验失败返回明确原因（400 语义由调用方映射）：
 * - 目标源不存在/停用
 * - 模板缺取数声明（无 queries 且无 SpecChart 声明 = 静态快照不可重绑定）
 * - DSL 解析失败且无 queries 通道兜底（queries 存在时不阻断，仅 DSL 换源降级）
 */
import {
  createParser,
  jsonToUiSpec,
  serverLibrary,
} from "@ginkgo/components/server";
import { SOURCE_ID_RE } from "@ginkgo/chart-spec";
import type { DashboardRecord, DashboardQuery } from "./dashboardStore";

/** 目标源信息（DynamicSourceConfig 的结构子集，便于测试注入） */
export interface RetargetSourceInfo {
  id: string;
  name?: string;
  enabled?: boolean;
}

export type RetargetVerdict =
  | { ok: true; record: DashboardRecord }
  | {
      ok: false;
      reason: "invalid-source-id" | "source-unavailable" | "static-template" | "dsl-invalid";
      detail?: string;
    };

const parser = createParser(serverLibrary.toJSONSchema(), "Root");

interface SpecNodeLike {
  type?: unknown;
  typeName?: unknown;
  props?: unknown;
}

/** 递归替换 DSL 中 SpecChart 的 spec.sourceId（jsonToUiSpec 由调用方序列化回写） */
function rewriteSpecSourceIds(
  root: unknown,
  targetSourceId: string
): { changed: boolean; sawSpecChart: boolean } {
  let changed = false;
  let sawSpecChart = false;
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as SpecNodeLike;
    if (node.type === "element" && node.typeName === "SpecChart") {
      sawSpecChart = true;
      if (node.props && typeof node.props === "object") {
        const props = node.props as { spec?: unknown };
        if (props.spec && typeof props.spec === "object") {
          const spec = props.spec as { sourceId?: unknown };
          if (spec.sourceId !== targetSourceId) {
            spec.sourceId = targetSourceId;
            changed = true;
          }
        }
      }
    }
    if (node.props && typeof node.props === "object") {
      for (const v of Object.values(node.props as Record<string, unknown>)) walk(v);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v);
    }
  };
  walk(root);
  return { changed, sawSpecChart };
}

/**
 * 模板重绑定：整份取数声明指向 targetSourceId，返回新看板草稿。
 * 不落盘——调用方拿 record 走 create（新 id 由 store 生成）。
 */
export function retargetTemplate(
  template: DashboardRecord,
  targetSourceId: string,
  targetSource: RetargetSourceInfo | undefined,
  opts?: { prompt?: string }
): RetargetVerdict {
  if (!SOURCE_ID_RE.test(targetSourceId)) {
    return { ok: false, reason: "invalid-source-id", detail: targetSourceId };
  }
  if (!targetSource || targetSource.enabled === false) {
    return {
      ok: false,
      reason: "source-unavailable",
      detail: `数据源不可用: ${targetSourceId}（不存在或已停用）`,
    };
  }
  if (template.kind !== "template") {
    return {
      ok: false,
      reason: "static-template",
      detail: "该记录不是模板（kind ≠ template）",
    };
  }

  const queries: DashboardQuery[] | undefined = template.queries?.map((q) => ({
    ...q,
    sourceId: targetSourceId,
  }));

  // DSL：SpecChart 声明节点换源（queries 有值 + DSL 无 SpecChart 也可——旧绑定型模板）
  const hasQueries = queries !== undefined && queries.length > 0;
  let dsl = template.dsl;
  let sawSpecChart = false;
  let dslInvalid = false;
  if (template.dsl) {
    try {
      const parsed = parser.parse(template.dsl);
      if (parsed.root) {
        const result = rewriteSpecSourceIds(parsed.root, targetSourceId);
        sawSpecChart = result.sawSpecChart;
        if (result.changed) {
          dsl = jsonToUiSpec(parsed.root, serverLibrary);
        }
      } else {
        dslInvalid = true;
      }
    } catch {
      // DSL 解析失败：queries 通道仍可换源（不阻断）；无 queries 时如实上报 dsl-invalid
      dslInvalid = true;
    }
  }

  if (!hasQueries && !sawSpecChart) {
    if (dslInvalid) {
      return {
        ok: false,
        reason: "dsl-invalid",
        detail: "模板 DSL 解析失败且无 queries 取数声明，无法重绑定",
      };
    }
    return {
      ok: false,
      reason: "static-template",
      detail: "模板无取数声明（queries 与 SpecChart 声明均为空），无法重绑定",
    };
  }

  const now = Date.now();
  // 剥离 origin：模板若源自收藏（origin.messageId 指向原看板），
  // 带着它 upsert 会命中原收藏并覆盖原看板——模板副本必须走全新创建
  const { origin: _origin, ...rest } = template;
  void _origin;
  const draft: DashboardRecord = {
    ...rest,
    id: template.id, // 新 id 由 store.create 生成，此处占位
    kind: "favorite",
    templateMeta: undefined,
    dsl,
    ...(queries && queries.length > 0 ? { queries } : {}),
    ...(template.bindings ? { bindings: template.bindings } : {}),
    ...(template.transforms ? { transforms: template.transforms } : {}),
    ...(opts?.prompt ? { prompt: opts.prompt } : {}),
    // 目标源名称快照（调用方可覆盖）
    ...(targetSource?.name ? { sourceNames: [targetSource.name] } : {}),
    dataUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, record: draft };
}
