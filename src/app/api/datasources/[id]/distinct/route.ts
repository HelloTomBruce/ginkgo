import { datasources } from "@/lib/datasources";
import { getDistinctValues } from "@openui-apps/analytics/server";

/**
 * GET /api/datasources/:id/distinct?field=xxx&table=yyy — 字段去重值（筛选器选项）。
 *
 * - 200 `{ values, truncated, cached }`：truncated=true 表示超过
 *   DISTINCT_VALUES_CAP（200）条，前端应退化为自由输入框
 * - 400 参数非法（field/table 形态不合法）
 * - 404 源不存在或已停用
 * - 422 源类型不支持 distinct（非 db 源，前端退化为自由输入）
 * - 502 连接失败或查询失败
 * - 模块级 TTL 缓存（5 分钟）防压源
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const field = url.searchParams.get("field") ?? "";
    const table = url.searchParams.get("table") ?? "";
    if (!field || !table) {
      return Response.json(
        { error: "缺少必填参数：field 与 table" },
        { status: 400 }
      );
    }

    const verdict = await getDistinctValues(datasources, id, field, table);
    if (!verdict.ok) {
      switch (verdict.reason) {
        case "invalid-params":
          return Response.json(
            { error: `参数形态不合法: ${verdict.detail ?? ""}` },
            { status: 400 }
          );
        case "source-unavailable":
          return Response.json(
            { error: `数据源不可用: ${verdict.detail ?? id}（不存在/停用/连接失败）` },
            { status: 404 }
          );
        case "unsupported":
          return Response.json({
            values: [],
            truncated: false,
            cached: false,
            note: verdict.detail,
          });
        case "query-failed":
          return Response.json(
            { error: `去重查询失败: ${verdict.detail ?? ""}` },
            { status: 502 }
          );
      }
    }

    return Response.json({
      values: verdict.values,
      truncated: verdict.truncated,
      cached: verdict.cached,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
