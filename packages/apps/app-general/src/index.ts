import type { AppPackageDefinition } from "@openui-analytics/app-sdk";
import { generalManifest, generalClient } from "./manifest";
import { buildGeneralSystemPrompt } from "./prompt";

export const generalAppPackage: AppPackageDefinition = {
  manifest: generalManifest,
  client: generalClient,
  server: {
    buildSystemPrompt: buildGeneralSystemPrompt,
    requiresDataTools: false,
  },
};

export default generalAppPackage;
export * from "./manifest";
export * from "./prompt";
