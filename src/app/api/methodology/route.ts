import { buildMethodologyOverview } from "@openui-apps/analytics/server";

/**
 * GET /api/methodology — 分析方法论查看入口的数据源（宿主薄壳）。
 * 响应组装与卡集合并全在 @openui-apps/analytics/server（领域自治），
 * 鉴权由 middleware 统一拦截 /api/*。
 */
export async function GET() {
  try {
    return Response.json(buildMethodologyOverview());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
