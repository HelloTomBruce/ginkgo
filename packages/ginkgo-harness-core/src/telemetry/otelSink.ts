import type { HarnessEvent, TelemetrySink } from "./telemetry";

/**
 * OTel sink 适配器（WS-13）：把 HarnessEvent 映射为 span 树。
 *
 * 依赖形态：**结构化注入**——调用方从自己的 OTel SDK 传入 Tracer，本模块只依赖
 * 最小形状接口（@opentelemetry/api 的 Span/Tracer 天然结构兼容），包零 OTel 依赖。
 *
 * span 树：run_start → 根 span（harness.run），step_finish/tool_result →
 * 即时结束的子 span，task_finish/abort → 根 span 终结。runId 无终态事件的
 * 泄漏由 30 分钟 prune 兜底。
 */

export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException?(error: Error): void;
  end?(endTime?: number): void;
}

export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: {
      startTime?: number;
      attributes?: Record<string, string | number | boolean>;
    }
  ): OtelSpanLike;
}

export interface OtelSinkOptions {
  tracer: OtelTracerLike;
  /** WS-8 实例标识（多副本区分事件来源）；缺省读 env LLM_INSTANCE_ID */
  instanceId?: string;
  serviceName?: string;
}

interface RunSpanEntry {
  span: OtelSpanLike;
  startedAt: number;
}

const ROOT_SPAN_MAX_AGE_MS = 30 * 60 * 1000;

export function createOtelSink(opts: OtelSinkOptions): TelemetrySink {
  const instanceId = opts.instanceId ?? process.env.LLM_INSTANCE_ID;
  const runs = new Map<string, RunSpanEntry>();

  const baseAttributes = (): Record<string, string | number | boolean> => ({
    "service.name": opts.serviceName ?? "ginkgo",
    ...(instanceId !== undefined ? { "instance.id": instanceId } : {}),
  });

  const pruneStale = (): void => {
    const now = Date.now();
    for (const [runId, entry] of runs) {
      if (now - entry.startedAt > ROOT_SPAN_MAX_AGE_MS) {
        entry.span.end?.();
        runs.delete(runId);
      }
    }
  };

  function handleEvent(event: HarnessEvent): void {
    pruneStale();
    const root = event.runId !== undefined ? runs.get(event.runId) : undefined;
    switch (event.type) {
      case "run_start": {
        const span = opts.tracer.startSpan("harness.run", {
          attributes: {
            ...baseAttributes(),
            "run.id": event.runId,
            ...(event.sessionId !== undefined ? { "session.id": event.sessionId } : {}),
            "harness.mode": event.mode,
            "harness.model": event.model,
            "harness.max_steps": event.maxSteps,
          },
        });
        runs.set(event.runId, { span, startedAt: Date.now() });
        break;
      }
      case "step_finish": {
        const span = opts.tracer.startSpan("harness.step", {
          attributes: {
            ...baseAttributes(),
            "run.id": event.runId,
            "harness.step": event.step,
            "harness.finish_reason": event.finishReason,
            "harness.tool_calls": event.toolCalls.join(","),
            ...(event.promptTokens !== undefined
              ? { "harness.prompt_tokens": event.promptTokens }
              : {}),
            "harness.duration_ms": event.durationMs,
          },
        });
        span.end?.();
        break;
      }
      case "tool_result": {
        const span = opts.tracer.startSpan("harness.tool", {
          attributes: {
            ...baseAttributes(),
            ...(event.runId !== undefined ? { "run.id": event.runId } : {}),
            "harness.tool": event.tool,
            ...(event.sourceId !== undefined ? { "datasource.id": event.sourceId } : {}),
            "harness.ok": event.ok,
            "harness.result_bytes": event.bytes,
            "harness.duration_ms": event.durationMs,
          },
        });
        span.end?.();
        break;
      }
      case "context_projection": {
        root?.span.setAttribute("harness.context_pruned", event.pruned);
        root?.span.setAttribute("harness.context_summarized", event.summarized);
        root?.span.setAttribute("harness.context_estimated_tokens", event.estimated);
        break;
      }
      case "warn": {
        root?.span.setAttribute("harness.last_warn_code", event.code);
        break;
      }
      case "error": {
        root?.span.setAttribute("harness.last_error_code", event.code);
        root?.span.setAttribute("error", true);
        root?.span.recordException?.(new Error(event.detail ?? event.code));
        break;
      }
      case "task_finish": {
        if (!root) break;
        root.span.setAttribute("harness.termination", event.termination);
        root.span.setAttribute("harness.status", event.status);
        if (event.totalPromptTokens !== undefined) {
          root.span.setAttribute("harness.total_prompt_tokens", event.totalPromptTokens);
        }
        if (event.totalCompletionTokens !== undefined) {
          root.span.setAttribute("harness.total_completion_tokens", event.totalCompletionTokens);
        }
        root.span.setAttribute("harness.duration_ms", event.durationMs);
        root.span.end?.();
        runs.delete(event.runId);
        break;
      }
      case "abort": {
        if (!root) break;
        root.span.setAttribute("harness.abort_reason", event.reason);
        root.span.end?.();
        if (event.runId) runs.delete(event.runId);
        break;
      }
      case "reconnect": {
        root?.span.setAttribute("harness.reconnect_replayed_chunks", event.replayedChunks);
        break;
      }
    }
  }

  return {
    emit: (event) => {
      try {
        handleEvent(event);
      } catch {
        // 观测出口故障不拖垮主链路
      }
    },
  };
}
