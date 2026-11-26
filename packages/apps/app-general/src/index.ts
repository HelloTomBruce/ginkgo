import type { AppPackageDefinition } from "@ginkgo/app-sdk";
import { generalManifest, generalClient } from "./manifest";
import { buildGeneralSystemPrompt } from "./prompt";

// 注意：server.getTools 的运行时实现（含 Node 内置模块）在 ./server 入口，
// 由宿主组合根（runtimeServers.ts）注入——主入口必须保持客户端 bundle 安全。
export const generalAppPackage: AppPackageDefinition = {
  manifest: generalManifest,
  client: generalClient,
  server: {
    buildSystemPrompt: buildGeneralSystemPrompt,
    needsWorkspace: true,
    requiresDataTools: false,
    requiredCapabilities: ["workspace_sandbox", "filesystem", "bash", "browser"],
  },
};

export default generalAppPackage;
export * from "./manifest";
export * from "./prompt";
export * from "./client/ArtifactViewer";
