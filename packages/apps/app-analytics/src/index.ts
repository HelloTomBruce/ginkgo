import type { AppPackageDefinition } from "@openui-analytics/app-sdk";
import { analyticsManifest, analyticsClient } from "./manifest";
import { buildAnalyticsSystemPrompt } from "./prompt";
import { getAnalyticsTools } from "./server/tools";

export const analyticsAppPackage: AppPackageDefinition = {
  manifest: analyticsManifest,
  client: analyticsClient,
  server: {
    buildSystemPrompt: buildAnalyticsSystemPrompt,
    getTools: getAnalyticsTools,
    requiresDataTools: true,
    requiredCapabilities: ["sql_query", "chart_spec", "methodology"],
  },
};

export default analyticsAppPackage;
export * from "./manifest";
export * from "./prompt";
export * from "./server/tools";
export * from "./client";
