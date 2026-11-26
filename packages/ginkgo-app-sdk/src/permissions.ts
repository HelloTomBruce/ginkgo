import type { AppManifest, AppPermission } from "./types";

/**
 * 权限模型 v1（对齐 docs/platform-ecosystem-roadmap.md §2 P1）。
 *
 * 设计取舍：宿主**不猜**工具属于哪个权限类别。应用在
 * `server.toolPermissions` 里显式声明「工具名 → 所需权限」，宿主只做集合判定。
 * 这样宿主零领域语义，也不存在「工具名启发式归类」这种脆弱实现。
 *
 * default deny 规则：
 *   - `manifest.permissions` 未声明 → 视为**平台内置/受信应用**，不过滤（保持现状）；
 *   - 已声明 → 只有「声明了 toolPermissions 且该权限在 permissions 内」的工具放行，
 *     未映射的工具一律丢弃。
 */

/** 权限的中文展示名（安装确认 UI 使用，避免 UI 侧硬编码文案） */
export const APP_PERMISSION_LABELS: Record<AppPermission, string> = {
  "datasources.read": "读取数据源（查询结果进入模型上下文）",
  "workspace.write": "写入会话工作区（创建/修改文件）",
  "shell.execute": "在工作区执行 shell 命令",
  "network.outbound": "发起外部网络请求",
  "mcp.access": "访问已配置的 MCP 服务",
};

/** 权限展示名兜底（第三方声明了平台未知权限时不至于渲染空串） */
export function describeAppPermission(permission: string): string {
  return (
    APP_PERMISSION_LABELS[permission as AppPermission] ?? `未知权限：${permission}`
  );
}

export interface PermissionFilterResult<T> {
  /** 放行的工具 */
  tools: Record<string, T>;
  /** 被剥离的工具名 → 原因 */
  stripped: Record<string, string>;
}

/**
 * 按 manifest 权限声明过滤应用工具集（宿主在工具装配处调用）。
 *
 * @param manifest  应用清单（`permissions` 决定是否过滤）
 * @param toolPermissions  应用声明的「工具名 → 所需权限」映射
 * @param tools  应用返回的工具集
 */
export function filterToolsByPermission<T>(
  manifest: Pick<AppManifest, "permissions" | "id">,
  toolPermissions: Record<string, AppPermission> | undefined,
  tools: Record<string, T>
): PermissionFilterResult<T> {
  // 未声明 permissions = 平台内置/受信应用，保持既有行为
  if (!manifest.permissions) {
    return { tools, stripped: {} };
  }

  const granted = new Set<string>(manifest.permissions);
  const declared = toolPermissions ?? {};
  const allowed: Record<string, T> = {};
  const stripped: Record<string, string> = {};

  for (const [name, tool] of Object.entries(tools)) {
    const required = declared[name];
    if (!required) {
      stripped[name] = "未在 server.toolPermissions 中声明所需权限（default deny）";
      continue;
    }
    if (!granted.has(required)) {
      stripped[name] = `缺少权限 ${required}`;
      continue;
    }
    allowed[name] = tool;
  }

  return { tools: allowed, stripped };
}

/** 计算「包声明但未被确认」的权限差集（安装握手用） */
export function diffUnacknowledgedPermissions(
  declared: readonly string[] | undefined,
  acknowledged: readonly string[] | undefined
): AppPermission[] {
  if (!declared || declared.length === 0) return [];
  const ack = new Set(acknowledged ?? []);
  return declared.filter((p) => !ack.has(p)) as AppPermission[];
}
