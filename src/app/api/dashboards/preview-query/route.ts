import { handlePreviewQuery } from "@ginkgo-apps/analytics/server";
import { datasources } from "@/lib/datasources";

/**
 * POST /api/dashboards/preview-query — 宿主薄壳：拆包转发到 analytics 包
 * server 编排（handlePreviewQuery），组合根注入数据源管理器单例。
 */
export async function POST(request: Request) {
  return handlePreviewQuery(request, { datasources });
}
