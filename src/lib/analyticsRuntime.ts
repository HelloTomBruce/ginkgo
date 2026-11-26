import {
  createAnalyticsServer,
  type AnalyticsArtifactServices,
} from "@ginkgo/app-analytics/server";
import { datasources } from "@/lib/datasources";
import { createAppMethodology } from "@ginkgo/app-analytics/server";
import { dashboardStore } from "@ginkgo/app-analytics/server";
import { refreshDashboard } from "@ginkgo/app-analytics/server";
import { getStoragePath } from "@/lib/storagePaths";

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
  // 组合根显式注入用户方法卡目录（随存储根解析，不依赖包内 cwd 兜底）
  methodology: createAppMethodology(getStoragePath("data", "methodology")).library,
  artifacts,
});
