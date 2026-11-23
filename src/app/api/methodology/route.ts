import { io } from "next/cache";
import { buildMethodologyOverview } from "@ginkgo-apps/analytics/server";

/**
 * GET /api/methodology — 分析方法论查看入口的数据源（宿主薄壳）。
 * 响应组装与卡集合并全在 @ginkgo-apps/analytics/server（领域自治），
 * 鉴权由 middleware 统一拦截 /api/*。
 *
 * 卡集是同步读盘的运行时状态：cacheComponents 下不做声明的纯同步 GET
 * 会在构建期预渲染、把清单固化进静态产物，故先声明请求时 IO 再读。
 */
export async function GET() {
  await io();
  try {
    return Response.json(buildMethodologyOverview());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
