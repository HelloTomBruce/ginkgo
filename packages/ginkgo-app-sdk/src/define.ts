import type { AppPackageDefinition } from "./types";

/**
 * 应用包定义助手：提供字段级类型补全与唯一性/形态预留校验挂点。
 * 纯标识函数（返回入参原对象），零运行时开销。
 *
 * @example
 * ```ts
 * export default defineApp({
 *   manifest: { id: "devops", name: "研发效能助手", description: "...", icon: "GitBranch" },
 *   client: { welcomeMessage: "...", presetQueries: [...] },
 *   server: { requiredCapabilities: ["workspace_sandbox"] },
 * });
 * ```
 */
export function defineApp(config: AppPackageDefinition): AppPackageDefinition {
  if (!config.manifest?.id || typeof config.manifest.id !== "string") {
    throw new Error("[defineApp] manifest.id 必填（小写字母数字与 - _，如 \"analytics\"）");
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(config.manifest.id)) {
    throw new Error(
      `[defineApp] manifest.id 非法（需匹配 /^[a-z0-9_-]{1,64}$/）: ${config.manifest.id}`
    );
  }
  if (!config.client?.welcomeMessage) {
    throw new Error("[defineApp] client.welcomeMessage 必填（新会话默认欢迎语）");
  }
  return config;
}
