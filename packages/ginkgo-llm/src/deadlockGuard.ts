/**
 * 工具调用参数死锁熔断守卫（领域中立编排设施）。
 *
 * 为什么需要：模型遇到工具报错时，可能拿完全相同的参数反复重试直到耗尽
 * maxSteps——全局步数熔断生效前会白白烧掉几十步 token。本守卫在 execute 层
 * 拦截：同一（toolName + 参数）签名连续失败达到阈值后，第三次起不再真实执行，
 * 直接回传含行动指引的熔断结果（修正参数 / 换工具 / 如实收尾），模型可在下一
 * 步自我纠正——与 repairToolCall 重定向通路同一体验。
 *
 * 失败判定复用 app-sdk 的 isToolFailureLike（宽容守卫），统一覆盖
 * toolFailure / zodTool / 只读拦截 / 裸 {error} 等全部历史错误形状；
 * 成功即清零该签名计数（参数演变或瞬时故障恢复不误熔）；
 * AbortError 由内层 safeExecutionAspect 透传，本守卫不吞不计。
 */
import { createHash } from "node:crypto";
import type { CoreTool, ToolExecutionOptions } from "ai";
import { isToolFailureLike } from "@ginkgolab/app-sdk";

/** 同一签名允许的真实失败执行次数；第 MAX+1 次同参调用被拦截 */
export const MAX_IDENTICAL_FAILURES = 2;

/** 每请求一份的签名失败计数容器（跨模型链 fallback 重试存活） */
export interface ToolDeadlockState {
  failures: Map<string, number>;
}

export function createToolDeadlockState(): ToolDeadlockState {
  return { failures: new Map() };
}

/** 熔断发生时的上报回调负载 */
export interface DeadlockFuseInfo {
  toolName: string;
  failureCount: number;
}

export interface DeadlockGuardOptions {
  onFuse?: (info: DeadlockFuseInfo) => void;
}

/**
 * 递归排序 key 的确定性序列化：同参异序（对象字面量键序不定）不得误判为不同签名。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** 工具调用签名：toolName + 规范化参数 的 sha256（手法同 queryCache.computeQueryHashKey） */
export function computeToolCallSignature(toolName: string, args: unknown): string {
  return createHash("sha256")
    .update(`${toolName}:${stableStringify(args)}`)
    .digest("hex");
}

/**
 * 给工具表包上死锁熔断守卫（包装在 instrumentTools 切面之外，签名计数对
 * telemetry/readonly/safeExecution 全部生效）。无 execute 的声明式工具原样透传。
 */
export function withDeadlockGuard(
  tools: Record<string, CoreTool>,
  state: ToolDeadlockState,
  options?: DeadlockGuardOptions
): Record<string, CoreTool> {
  const wrapped: Record<string, CoreTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    if (typeof execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    wrapped[name] = {
      ...tool,
      execute: async (args: unknown, execOptions: ToolExecutionOptions) => {
        const signature = computeToolCallSignature(name, args);
        const failedCount = state.failures.get(signature) ?? 0;
        if (failedCount >= MAX_IDENTICAL_FAILURES) {
          options?.onFuse?.({ toolName: name, failureCount: failedCount });
          return {
            isError: true,
            error: `【死锁熔断】工具 "${name}" 已连续 ${failedCount} 次以完全相同的参数调用并全部失败，本次调用已被系统拦截、未执行。请立即停止重复该调用：1) 修正参数中的错误后重试；2) 改用其他工具完成同一目标；3) 若确认无路可走，请如实在回复中说明困难，并调用 finish_task（status=insufficient_data）收尾。`,
          };
        }
        const result = await execute.call(tool, args, execOptions);
        if (isToolFailureLike(result)) {
          state.failures.set(signature, failedCount + 1);
        } else {
          // 成功即清除该签名计数：参数演变或瞬时故障恢复不应被历史失败拖入误熔
          state.failures.delete(signature);
        }
        return result;
      },
    } as CoreTool;
  }
  return wrapped;
}
