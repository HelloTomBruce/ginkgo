import type { AppServerContext } from "@openui-analytics/app-sdk";

/**
 * 数据分析应用专属能力工具声明（SQL 探查、数据源工具与方法论）
 */
export async function getAnalyticsTools(ctx: AppServerContext): Promise<Record<string, unknown>> {
  // 数据分析专属工具清单
  return {
    description: "数据分析 SQL 查询、指标探查与跨源联合分析工具集",
    capabilities: ["sql_query", "chart_spec", "methodology"],
    activeSources: ctx.activeSources ?? [],
  };
}
