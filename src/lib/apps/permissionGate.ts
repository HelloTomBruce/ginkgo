import type { AppPermission } from "@ginkgolab/app-sdk";
import { filterToolsByPermission } from "@ginkgolab/app-sdk";
import { appRegistry } from "./registry";

/**
 * 工具权限门禁（宿主侧薄封装）。
 *
 * 路由只做「取工具 → 过门禁 → 返回」，判定逻辑与查询注册表都收敛在这里，
 * 便于单测覆盖而不必拉起整个 handler。
 *
 * 规则见 app-sdk 的 filterToolsByPermission：未声明 permissions 的应用
 * （平台内置）不过滤；声明了的走 default deny。
 */
export interface GateAppToolsResult<T> {
  tools: Record<string, T>;
  stripped: Record<string, string>;
}

export function gateAppTools<T>(
  appId: string,
  toolPermissions: Record<string, AppPermission> | undefined,
  tools: Record<string, T>
): GateAppToolsResult<T> {
  // 只对「已启用」应用取权限声明；拿不到（未注册/已停用）时按未声明处理，
  // 此时该应用本就不会装配出工具，不存在放大面。
  const app = appRegistry.getEnabled(appId);
  return filterToolsByPermission(
    { id: appId, permissions: app?.manifest.permissions },
    toolPermissions,
    tools
  );
}
