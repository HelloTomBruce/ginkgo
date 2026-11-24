import type { AppPackageDefinition } from "@ginkgo/app-sdk";
import { designManifest, designClient } from "./manifest";
import { buildDesignPrompt } from "./prompt";

export const designAppPackage: AppPackageDefinition = {
  manifest: designManifest,
  client: designClient,
  server: {
    buildSystemPrompt: buildDesignPrompt,
    needsWorkspace: true,
    requiresDataTools: false,
    requiredCapabilities: ["workspace_sandbox", "filesystem", "claude_design", "claude_design_system"],
  },
};

export default designAppPackage;
export * from "./manifest";
export * from "./prompt";
export * from "./client/DesignStudioViewer";
