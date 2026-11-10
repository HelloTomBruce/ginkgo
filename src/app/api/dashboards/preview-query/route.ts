import { datasources } from "@/lib/datasources";
import { materializeSpecRows, TABLE_RE } from "@/lib/specMaterialize";
import { parseChartSpec } from "@openui-analytics/chart-spec";

/**
 * POST /api/dashboards/preview-query — SpecChart 筛选联动重物化（M2-4，零 LLM）。
 *
 * 声明式联动的取数端点：SpecChart 订阅 filterBus 后把「自身 spec + 合并后的
 * 筛选值」POST 到此，服务端 materializeSpecRows 重物化并返回行数组。
 * 入参是图表级声明（sourceId/table/spec），无需 dashboardId/dsl 贯穿。
 *
 * - 200 `{ rows }`
 * - 400 spec 形态非法 / 表名非法 / 字段不存在（幻觉字段防护，附 missing）
 * - 404 源不存在或已停用
 * - 422 源类型不支持（非 db 源，M3 提供 TransformSpec 退化路径）
 * - 502 连接失败或物化执行失败
 */
export async function POST(request: Request) {
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

    const source = datasources.get(sourceId);
    if (!source) {
      return Response.json({ error: `数据源不存在: ${sourceId}` }, { status: 404 });
    }
    if (source.enabled === false) {
      return Response.json({ error: `数据源已停用: ${sourceId}` }, { status: 404 });
    }

    let conn;
    try {
      conn = await datasources.connect(source);
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
