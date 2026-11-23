import { handleCreateFromTemplate, dashboardStore } from "@openui-apps/analytics/server";
import { datasources } from "@/lib/datasources";

/**
 * POST /api/dashboards/from-template — 宿主薄壳：拆包转发到 analytics 包
 * server 编排（handleCreateFromTemplate），组合根注入数据源管理器单例与
 * 看板存储（barrel mock 不拦包内相对导入，store 经 deps 传递可测）。
 */
export async function POST(request: Request) {
  return handleCreateFromTemplate(request, { datasources, dashboardStore });
}
