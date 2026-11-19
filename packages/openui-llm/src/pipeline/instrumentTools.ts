import type { CoreTool } from "ai";
import type { RunId, TelemetrySink } from "@openui-analytics/harness-core";
import { jsonByteSize } from "@openui-analytics/harness-core";

export interface ToolInstrumentationContext {
  runId: RunId;
  sessionId?: string;
  sourceId?: string;
  telemetry: TelemetrySink;
}

/**
 * 工具执行遥测包装:为数据源工具的 execute 叠加耗时/结果量级/成败采集,
 * 不改变工具的输入输出语义(含失败重抛)。无 execute 的纯查询型工具原样透传。
 */
export function instrumentTools(
  tools: Record<string, CoreTool>,
  ctx: ToolInstrumentationContext
): Record<string, CoreTool> {
  const wrapped: Record<string, CoreTool> = {};
  for (const [name, t] of Object.entries(tools)) {
    const orig = t as { execute?: (args: unknown, opts: unknown) => Promise<unknown> };
    if (typeof orig.execute !== "function") {
      wrapped[name] = t;
      continue;
    }
    const origExecute = orig.execute.bind(t);
    wrapped[name] = {
      ...t,
      execute: async (args: unknown, callOpts: unknown) => {
        const t0 = Date.now();
        try {
          const result = await origExecute(args, callOpts);
          ctx.telemetry.emit({
            type: "tool_result",
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            tool: name,
            sourceId: ctx.sourceId,
            ok: !(
              result &&
              typeof result === "object" &&
              (result as { isError?: unknown }).isError === true
            ),
            bytes: jsonByteSize(result),
            durationMs: Date.now() - t0,
          });
          return result;
        } catch (err) {
          ctx.telemetry.emit({
            type: "tool_result",
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            tool: name,
            sourceId: ctx.sourceId,
            ok: false,
            bytes: -1,
            durationMs: Date.now() - t0,
          });
          throw err;
        }
      },
    } as CoreTool;
  }
  return wrapped;
}
