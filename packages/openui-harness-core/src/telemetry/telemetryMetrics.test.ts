import { describe, expect, it } from "vitest";
import { createMetricsSink } from "./telemetryMetrics";
import type { HarnessEvent } from "./telemetry";

describe("createMetricsSink", () => {
  it("计数器按 label 聚合；snapshot 与 Prometheus 文本一致", () => {
    const metrics = createMetricsSink();
    const events: HarnessEvent[] = [
      { type: "run_start", runId: "r1", mode: "direct", model: "m", maxSteps: 10 },
      { type: "run_start", runId: "r2", mode: "plan", model: "m", maxSteps: 6 },
      {
        type: "task_finish",
        runId: "r1",
        termination: "natural",
        status: "completed",
        durationMs: 3000,
        totalPromptTokens: 4000,
        totalCompletionTokens: 1000,
      },
      {
        type: "task_finish",
        runId: "r2",
        termination: "budget_exhausted",
        status: "truncated",
        durationMs: 20_000,
      },
      { type: "abort", runId: "r3", sessionId: "s", reason: "user" },
      { type: "abort", runId: "r4", sessionId: "s", reason: "user" },
      {
        type: "tool_result",
        runId: "r1",
        tool: "db_query",
        ok: true,
        bytes: 100,
        durationMs: 25,
      },
      {
        type: "tool_result",
        runId: "r1",
        tool: "db_query",
        ok: false,
        bytes: -1,
        durationMs: 40,
      },
      {
        type: "step_finish",
        runId: "r1",
        step: 1,
        finishReason: "tool-calls",
        toolCalls: [],
        durationMs: 800,
      },
    ];
    for (const e of events) metrics.sink.emit(e);

    const snap = metrics.snapshot();
    expect(snap.runsByMode).toEqual({ direct: 1, plan: 1 });
    expect(snap.taskFinish['status="completed",termination="natural"']).toBe(1);
    expect(snap.abortsByReason).toEqual({ user: 2 });
    expect(snap.tools.db_query).toEqual({ ok: 1, failed: 1, totalDurationMs: 65 });

    const text = metrics.renderPrometheus({ harness_hub_running: 2 });
    expect(text).toContain('harness_runs_total{mode="direct"} 1');
    expect(text).toContain('harness_task_finish_total{status="truncated",termination="budget_exhausted"} 1');
    expect(text).toContain('harness_abort_total{reason="user"} 2');
    expect(text).toContain('harness_tool_results_total{tool="db_query",ok="true"} 1');
    expect(text).toContain('harness_step_duration_ms_bucket{finish_reason="tool-calls",le="1000"} 1');
    expect(text).toContain('harness_task_total_tokens_count{status="completed"} 1');
    expect(text).toContain("# TYPE harness_hub_running gauge");
    expect(text).toContain("harness_hub_running 2");
  });

  it("直方图落桶正确：值落在上界边界计入该桶", () => {
    const metrics = createMetricsSink();
    metrics.sink.emit({
      type: "task_finish",
      runId: "r1",
      termination: "natural",
      status: "completed",
      durationMs: 1000,
    });
    const text = metrics.renderPrometheus();
    expect(text).toContain('harness_task_duration_ms_bucket{status="completed",le="1000"} 1');
    expect(text).toContain('harness_task_duration_ms_bucket{status="completed",le="500"} 0');
    expect(text).toContain('harness_task_duration_ms_sum{status="completed"} 1000');
  });

  it("sink 异常不外抛（聚合器故障不拖垮主链路）", () => {
    const metrics = createMetricsSink();
    // 畸形事件（缺字段）：handleEvent 应安全吞掉而非抛错
    expect(() =>
      metrics.sink.emit({ type: "abort" } as unknown as HarnessEvent)
    ).not.toThrow();
    expect(() =>
      metrics.sink.emit({ type: "task_finish" } as unknown as HarnessEvent)
    ).not.toThrow();
  });
});
