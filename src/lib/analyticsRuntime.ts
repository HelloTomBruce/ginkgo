import {
  createAnalyticsServer,
  type AnalyticsArtifactServices,
} from "@openui-apps/analytics/server";
import { datasources } from "@/lib/datasources";
import { createAppMethodology } from "@openui-apps/analytics/server";
import { dashboardStore } from "@openui-apps/analytics/server";
import { refreshDashboard } from "@openui-apps/analytics/server";

/**
 * analytics 运行时服务端单例（宿主组合根）：
 * 统一注入数据源单例、合并方法论库与产物服务（看板存储 + 活看板刷新引擎），
 * 供 /api/analyze（prompt/工具/收尾钩子）与 /api/dashboards/[id]/refresh
 * （产物刷新协议）共享同一装配实例。
 */
const artifacts: AnalyticsArtifactServices = {
  // 结构兼容（DashboardRecord 是 AnalyticsDashboardRecordLike 的超集）
  dashboards: dashboardStore as unknown as AnalyticsArtifactServices["dashboards"],
  refreshDashboard: refreshDashboard as unknown as AnalyticsArtifactServices["refreshDashboard"],
};

export const analyticsServer = createAnalyticsServer({
  datasources,
  methodology: createAppMethodology().library,
  artifacts,
});
