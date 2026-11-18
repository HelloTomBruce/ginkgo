import { describe, expect, it, vi } from "vitest";
import { createOtelSink, type OtelSpanLike, type OtelTracerLike } from "./otelSink";
import type { HarnessEvent } from "./telemetry";

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  ended: boolean;
  exceptions: Error[];
}

function makeFakeTracer() {
  const spans: RecordedSpan[] = [];
  const tracer: OtelTracerLike = {
    startSpan(name, options) {
      const span: RecordedSpan & OtelSpanLike = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false,
        exceptions: [],
        setAttribute(key, value) {
          span.attributes[key] = value;
        },
        recordException(error) {
          span.exceptions.push(error);
        },
        end() {
          span.ended = true;
        },
      };
      spans.push(span);
      return span;
    },
  };
  return { tracer, spans };
}

const RUN_START: HarnessEvent = {
  type: "run_start",
  runId: "run-1",
  sessionId: "sess-1",
  mode: "direct",
  model: "test-model",
  maxSteps: 10,
};

describe("otelSink span 树映射", () => {
  it("run_start 开根 span，step/tool 为即时子 span，task_finish 终结根 span", () => {
    const { tracer, spans } = makeFakeTracer();
    const sink = createOtelSink({ tracer, instanceId: "instance-a" });
    sink.emit(RUN_START);
    sink.emit({
      type: "step_finish",
      runId: "run-1",
      step: 1,
      finishReason: "tool-calls",
      toolCalls: ["db_query"],
      durationMs: 120,
    });
    sink.emit({
      type: "tool_result",
      runId: "run-1",
      tool: "db_query",
      ok: true,
      bytes: 2048,
      durationMs: 30,
    });
    sink.emit({
      type: "task_finish",
      runId: "run-1",
      termination: "natural",
      status: "completed",
      totalPromptTokens: 500,
      durationMs: 900,
    });

    expect(spans.map((s) => s.name)).toEqual(["harness.run", "harness.step", "harness.tool"]);
    const [root, step, tool] = spans;
    expect(root.attributes["instance.id"]).toBe("instance-a");
    expect(root.attributes["harness.model"]).toBe("test-model");
    expect(root.attributes["harness.termination"]).toBe("natural");
    expect(root.attributes["harness.total_prompt_tokens"]).toBe(500);
    expect(root.ended).toBe(true);
    expect(step.ended).toBe(true);
    expect(step.attributes["harness.duration_ms"]).toBe(120);
    expect(tool.attributes["harness.ok"]).toBe(true);
  });

  it("error 事件记录异常并打 error 标记；abort 终结根 span", () => {
    const { tracer, spans } = makeFakeTracer();
    const sink = createOtelSink({ tracer });
    sink.emit(RUN_START);
    sink.emit({ type: "error", runId: "run-1", code: "STREAM_ERROR", detail: "boom" });
    const root = spans[0];
    expect(root.attributes["error"]).toBe(true);
    expect(root.exceptions[0]?.message).toBe("boom");
    expect(root.ended).toBe(false);

    sink.emit({ type: "abort", runId: "run-1", sessionId: "sess-1", reason: "user" });
    expect(root.attributes["harness.abort_reason"]).toBe("user");
    expect(root.ended).toBe(true);
  });

  it("sink 异常不外抛（观测出口故障不拖垮主链路）", () => {
    const tracer: OtelTracerLike = {
      startSpan: vi.fn(() => {
        throw new Error("otel down");
      }),
    };
    const sink = createOtelSink({ tracer });
    expect(() => sink.emit(RUN_START)).not.toThrow();
  });

  it("无终态事件的 run 由 30 分钟 prune 兜底终结", () => {
    vi.useFakeTimers();
    const { tracer, spans } = makeFakeTracer();
    const sink = createOtelSink({ tracer });
    sink.emit(RUN_START);
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    // 下一个事件触发 prune
    sink.emit({ type: "run_start", runId: "run-2", mode: "plan", model: "m", maxSteps: 5 });
    expect(spans[0].ended).toBe(true);
    vi.useRealTimers();
  });
});
