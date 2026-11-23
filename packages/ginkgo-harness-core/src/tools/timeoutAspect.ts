import type { ToolInterceptor } from "./types";

export class ToolTimeoutError extends Error {
  constructor(public readonly toolName: string, public readonly timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

/**
 * 工具执行单次调用硬超时拦截器：
 * 超过指定毫秒数未返回则中断并抛出 ToolTimeoutError，防止单个工具永久挂起。
 */
export function createTimeoutInterceptor(timeoutMs: number): ToolInterceptor {
  if (timeoutMs <= 0) {
    return async (args, _ctx, next) => next(args);
  }

  return async (args, ctx, next) => {
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ToolTimeoutError(ctx.toolName, timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([next(args), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
