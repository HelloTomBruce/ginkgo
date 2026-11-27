import { materializeSpecRows, TABLE_RE } from "./specMaterialize";
import { retargetTemplate } from "./templateRetarget";
import { parseChartSpec } from "@ginkgolab/chart-spec";
import type { DatasourceManager } from "@ginkgolab/datasources";
import { toSummary, type DashboardStore } from "./dashboardStore";

/**
 * /api/dashboards 厚路由的编排实现（宿主薄壳路由拆包转发 + 注入组合根单例）。
 * 职责边界：本模块做「入参校验 → 源可用性检查 → 编排 → Response 映射」；
 * datasources 管理器由宿主注入（组合根唯一装配，本包不感知宿主单例）。
 */

/** 组合根注入位（宿主薄壳传单例；测试注入 mock——barrel mock 不拦包内相对导入） */
export interface DashboardRouteDeps {
  datasources: DatasourceManager;
}
/** from-template 额外需要看板存储（落盘模板副本） */
export interface TemplateRouteDeps extends DashboardRouteDeps {
  dashboardStore: DashboardStore;
}

/**
 * POST /api/dashboards/preview-query — SpecChart 筛选联动重物化（M2-4，零 LLM）。
 * - 200 `{ rows }`
 * - 400 spec 形态非法 / 表名非法 / 字段不存在（幻觉字段防护，附 missing）
 * - 404 源不存在或已停用
 * - 422 源类型不支持（非 db 源，M3 提供 TransformSpec 退化路径）
 * - 502 连接失败或物化执行失败
 */
export async function handlePreviewQuery(
  request: Request,
  deps: DashboardRouteDeps
): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const { sourceId, table, spec } = (body ?? {}) as {
      sourceId?: string;
      table?: string;
      spec?: unknown;
    };

    const parsedSpec = parseChartSpec(spec);
    if (!parsedSpec) {
      return Response.json(
        { error: "spec 不是合法的 ChartSpec 声明" },
        { status: 400 }
      );
    }
    if (typeof table !== "string" || !TABLE_RE.test(table)) {
      return Response.json({ error: `表名不合法: ${String(table)}` }, { status: 400 });
    }
    if (typeof sourceId !== "string" || !sourceId) {
      return Response.json({ error: "缺少 sourceId" }, { status: 400 });
    }

    const source = deps.datasources.get(sourceId);
    if (!source) {
      return Response.json({ error: `数据源不存在: ${sourceId}` }, { status: 404 });
    }
    if (source.enabled === false) {
      return Response.json({ error: `数据源已停用: ${sourceId}` }, { status: 404 });
    }

    let conn;
    try {
      conn = await deps.datasources.connect(source);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: `数据源连接失败: ${detail}` },
        { status: 502 }
      );
    }
    const verdict = await materializeSpecRows(conn, source, sourceId, parsedSpec, table);
    if (!verdict.ok) {
      switch (verdict.reason) {
        case "mcp-unsupported":
          return Response.json({ error: verdict.detail }, { status: 422 });
        case "field-missing":
          return Response.json(
            { error: "字段不存在于数据源", missing: verdict.missing },
            { status: 400 }
          );
        case "invalid-source-id":
          return Response.json({ error: "sourceId 形态不合法" }, { status: 400 });
        default:
          return Response.json(
            { error: `物化失败: ${verdict.detail ?? ""}` },
            { status: 502 }
          );
      }
    }
    return Response.json({ rows: verdict.rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/dashboards/from-template — 用模板新建（换源重绑定，M3-4）。
 * 重绑定 → 新 id 落盘（kind 归位 favorite）→ 返回新记录。模板本体不动。
 * - 400 参数缺失/非法（含重绑定校验失败）
 * - 404 模板不存在 或 目标源不可用
 * - 201 `{ dashboard: 新记录摘要 }`
 */
export async function handleCreateFromTemplate(
  request: Request,
  deps: TemplateRouteDeps
): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as {
      templateId?: string;
      targetSourceId?: string;
      prompt?: string;
    } | null;
    if (!body || typeof body.templateId !== "string" || !body.templateId) {
      return Response.json({ error: "缺少 templateId" }, { status: 400 });
    }
    if (typeof body.targetSourceId !== "string" || !body.targetSourceId) {
      return Response.json({ error: "缺少 targetSourceId" }, { status: 400 });
    }

    const template = await deps.dashboardStore.get(body.templateId);
    if (!template) {
      return Response.json({ error: `模板不存在: ${body.templateId}` }, { status: 404 });
    }

    const targetSource = deps.datasources.get(body.targetSourceId);
    if (!targetSource || targetSource.enabled === false) {
      return Response.json(
        { error: `目标数据源不可用: ${body.targetSourceId}（不存在或已停用）` },
        { status: 404 }
      );
    }

    const verdict = retargetTemplate(template, body.targetSourceId, targetSource, {
      ...(typeof body.prompt === "string" && body.prompt ? { prompt: body.prompt } : {}),
    });
    if (!verdict.ok) {
      const status =
        verdict.reason === "static-template" || verdict.reason === "invalid-source-id"
          ? 400
          : 404;
      return Response.json({ error: verdict.detail ?? verdict.reason }, { status });
    }

    // 标题注记来源模板；prompt 缺省用模板抽象提问
    const draft = {
      ...verdict.record,
      title: `${template.title}（模板副本）`,
      prompt: verdict.record.prompt ?? template.templateMeta?.abstractPrompt,
    };

    const created = await deps.dashboardStore.upsert(draft);
    if (!created.ok) {
      return Response.json({ errors: created.errors }, { status: created.status });
    }
    return Response.json({ dashboard: toSummary(created.record) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
