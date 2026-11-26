/**
 * 工具失败结果的协议级契约与工厂。
 * 「简单工具失败」形状在三处生产（能力包执行包装层 / 编排安全切面 / 应用动作网关）
 * 与一处消费（宿主工具卡片）之间流转——工厂与守卫在此同源收敛，杜绝形状漂移。
 * 注：命令级富结构失败（如 bash 的 exitCode/stdout/stderr）属命令语义，不适用本契约。
 */

/** 规范化的简单工具失败结果（跨层工具结果协议） */
export interface ToolFailureResult {
  success: false;
  error: string;
  isError: true;
}

/**
 * 构造规范化工具失败结果。
 * toolName 存在时以 `[name]` 前缀注入 error，便于多工具会话中的失败溯源。
 */
export function toolFailure(
  toolName: string | null | undefined,
  message: string
): ToolFailureResult {
  return {
    success: false,
    error: toolName ? `[${toolName}] ${message}` : message,
    isError: true,
  };
}

/**
 * 宽容失败判定（消费侧守卫）：刻意比 ToolFailureResult 的结构判定更松——
 * 历史工具结果存在「仅携带 error 字段」等旧形状，收紧为严格结构会导致
 * UI 把真实失败误渲染为成功。
 */
export function isToolFailureLike(value: unknown): value is ToolFailureResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Boolean(v.error) || v.success === false || v.isError === true;
}
