import type { RunId } from "../telemetry/telemetry";

export interface ToolExecutionContext {
  toolName: string;
  callId?: string;
  runId?: RunId;
  sessionId?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 工具拦截器切面函数契约（洋葱模型）：
 * args: 工具入参
 * ctx: 执行上下文元数据
 * next: 调用后续拦截器或原生 execute
 */
export type ToolInterceptor = (
  args: unknown,
  ctx: ToolExecutionContext,
  next: (modifiedArgs?: unknown) => Promise<unknown>
) => Promise<unknown>;
