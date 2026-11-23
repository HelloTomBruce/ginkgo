import type { RunId, TelemetrySink } from "../telemetry/telemetry";
import { jsonByteSize } from "../telemetry/telemetry";
import type { ToolInterceptor } from "./types";

export interface TelemetryInterceptorOptions {
  telemetry: TelemetrySink;
  runId?: RunId;
  sessionId?: string;
  sourceId?: string;
}

/**
 * 工具遥测切面拦截器：
 * 自动统计工具执行耗时 (durationMs)、结果字节量 (bytes) 与成败状态，
 * 并向 TelemetrySink 发射 tool_result 事件，异常原样向上抛出。
 */
export function createTelemetryInterceptor(
  opts: TelemetryInterceptorOptions
): ToolInterceptor {
  return async (args, ctx, next) => {
    const t0 = Date.now();
    const runId = ctx.runId ?? opts.runId;
    const sessionId = ctx.sessionId ?? opts.sessionId;
    const sourceId = ctx.sourceId ?? opts.sourceId;

    try {
      const result = await next(args);
      const isErrorObj =
        result &&
        typeof result === "object" &&
        (result as { isError?: unknown }).isError === true;

      if (runId) {
        opts.telemetry.emit({
          type: "tool_result",
          runId,
          sessionId,
          tool: ctx.toolName,
          sourceId,
          ok: !isErrorObj,
          bytes: jsonByteSize(result),
          durationMs: Date.now() - t0,
        });
      }

      return result;
    } catch (err) {
      if (runId) {
        opts.telemetry.emit({
          type: "tool_result",
          runId,
          sessionId,
          tool: ctx.toolName,
          sourceId,
          ok: false,
          bytes: -1,
          durationMs: Date.now() - t0,
        });
      }
      throw err;
    }
  };
}
