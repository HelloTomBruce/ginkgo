import type { MiddlewareFunction } from "../pipeline";
import type { SessionStreamHub } from "../../stream/streamHub";

export interface ConcurrencyGateOptions {
  streamHub: SessionStreamHub;
  maxConcurrentTasks: number;
  isReconnect?: boolean;
}

/**
 * 进程/集群并发准入闸门中间件：
 * 限制同时处于 running 状态的任务数；超限时 429 拦截新请求（重连不占名额）
 */
export function createConcurrencyGateMiddleware(
  options: ConcurrencyGateOptions
): MiddlewareFunction {
  return async (ctx, next) => {
    const { streamHub, maxConcurrentTasks, isReconnect } = options;

    if (!isReconnect && ctx.sessionId) {
      const running = await streamHub.runningCount();
      if (running >= maxConcurrentTasks) {
        ctx.telemetry.emit({
          type: "warn",
          runId: ctx.runId,
          sessionId: ctx.sessionId,
          code: "CONCURRENCY_REJECTED",
          detail: `running 任务数已达上限 ${maxConcurrentTasks},拒绝新任务`,
        });
        ctx.response = Response.json(
          { error: "服务端分析任务并发已达上限，请稍后重试" },
          { status: 429 }
        );
        return;
      }
    }

    await next();
  };
}
