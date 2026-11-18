import type { HarnessEvent, TelemetrySink } from "./telemetry";

/**
 * 进程内聚合 sink + Prometheus 文本出口（WS-13）：
 * 计数器（run/task_finish by status/abort by reason/tool_result）+ 直方图
 * （step/task duration、totalTokens）。单实例自刷与 Prometheus pull 天然多副本
 * 兼容（每实例一个 target，按 instance label 聚合）；多副本优先 OTel push 路径。
 */

interface Histogram {
  help: string;
  buckets: number[];
  counts: Map<string, number[]>; // labelKey → per-bucket counts
  sums: Map<string, number>;
  totals: Map<string, number>;
}

const DURATION_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 300_000];
const TOKEN_BUCKETS = [1000, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

export interface MetricsRegistry {
  sink: TelemetrySink;
  /** 程序化读取（供 JSON 出口/测试断言） */
  snapshot(): {
    runsByMode: Record<string, number>;
    taskFinish: Record<string, number>;
    abortsByReason: Record<string, number>;
    tools: Record<string, { ok: number; failed: number; totalDurationMs: number }>;
  };
  /** Prometheus 文本格式（Content-Type: text/plain; version=0.0.4） */
  renderPrometheus(extraGauges?: Record<string, number>): string;
}

export function createMetricsSink(): MetricsRegistry {
  const runsByMode = new Map<string, number>();
  const taskFinish = new Map<string, number>(); // labelKey status|termination
  const abortsByReason = new Map<string, number>();
  const tools = new Map<string, { ok: number; failed: number; totalDurationMs: number }>();
  const stepDuration: Histogram = {
    help: "LLM harness per-step duration",
    buckets: DURATION_BUCKETS_MS,
    counts: new Map(),
    sums: new Map(),
    totals: new Map(),
  };
  const taskDuration: Histogram = {
    help: "LLM harness task wall-clock duration",
    buckets: DURATION_BUCKETS_MS,
    counts: new Map(),
    sums: new Map(),
    totals: new Map(),
  };
  const taskTokens: Histogram = {
    help: "LLM harness task total tokens (prompt+completion)",
    buckets: TOKEN_BUCKETS,
    counts: new Map(),
    sums: new Map(),
    totals: new Map(),
  };

  function observe(h: Histogram, labelKey: string, value: number): void {
    let counts = h.counts.get(labelKey);
    if (!counts) {
      counts = new Array(h.buckets.length + 1).fill(0);
      h.counts.set(labelKey, counts);
      h.sums.set(labelKey, 0);
      h.totals.set(labelKey, 0);
    }
    for (let i = 0; i < h.buckets.length; i++) {
      if (value <= h.buckets[i]) counts[i]++;
    }
    counts[h.buckets.length]++; // +Inf
    h.sums.set(labelKey, (h.sums.get(labelKey) ?? 0) + value);
    h.totals.set(labelKey, (h.totals.get(labelKey) ?? 0) + 1);
  }

  function handleEvent(event: HarnessEvent): void {
    switch (event.type) {
      case "run_start": {
        runsByMode.set(event.mode, (runsByMode.get(event.mode) ?? 0) + 1);
        break;
      }
      case "task_finish": {
        const key = `status="${event.status}",termination="${event.termination}"`;
        taskFinish.set(key, (taskFinish.get(key) ?? 0) + 1);
        observe(taskDuration, `status="${event.status}"`, event.durationMs);
        if (event.totalPromptTokens !== undefined || event.totalCompletionTokens !== undefined) {
          observe(
            taskTokens,
            `status="${event.status}"`,
            (event.totalPromptTokens ?? 0) + (event.totalCompletionTokens ?? 0)
          );
        }
        break;
      }
      case "abort": {
        abortsByReason.set(event.reason, (abortsByReason.get(event.reason) ?? 0) + 1);
        break;
      }
      case "tool_result": {
        const stat = tools.get(event.tool) ?? { ok: 0, failed: 0, totalDurationMs: 0 };
        if (event.ok) stat.ok++;
        else stat.failed++;
        stat.totalDurationMs += event.durationMs;
        tools.set(event.tool, stat);
        break;
      }
      case "step_finish": {
        observe(stepDuration, `finish_reason="${event.finishReason}"`, event.durationMs);
        break;
      }
      default:
        break;
    }
  }

  const sink: TelemetrySink = {
    emit: (event) => {
      try {
        handleEvent(event);
      } catch {
        // 指标聚合故障不拖垮主链路
      }
    },
  };

  function renderHistogram(name: string, h: Histogram): string {
    const lines = [`# HELP ${name} ${h.help}`, `# TYPE ${name} histogram`];
    for (const [labelKey, counts] of h.counts) {
      const labels = labelKey ? `{${labelKey},` : "{";
      for (let i = 0; i < h.buckets.length; i++) {
        const le = h.buckets[i] === Infinity ? "+Inf" : String(h.buckets[i]);
        lines.push(`${name}_bucket${labels}le="${le}"} ${counts[i]}`);
      }
      lines.push(`${name}_bucket${labels}le="+Inf"} ${counts[h.buckets.length]}`);
      lines.push(`${name}_sum${labelKey ? `{${labelKey}}` : ""} ${h.sums.get(labelKey) ?? 0}`);
      lines.push(`${name}_count${labelKey ? `{${labelKey}}` : ""} ${h.totals.get(labelKey) ?? 0}`);
    }
    return lines.join("\n");
  }

  return {
    sink,
    snapshot() {
      return {
        runsByMode: Object.fromEntries(runsByMode),
        taskFinish: Object.fromEntries(taskFinish),
        abortsByReason: Object.fromEntries(abortsByReason),
        tools: Object.fromEntries(tools),
      };
    },
    renderPrometheus(extraGauges = {}) {
      const lines: string[] = [];
      lines.push("# HELP harness_runs_total Analysis runs started");
      lines.push("# TYPE harness_runs_total counter");
      for (const [mode, count] of runsByMode) {
        lines.push(`harness_runs_total{mode="${mode}"} ${count}`);
      }
      lines.push("# HELP harness_task_finish_total Tasks finished by status and termination");
      lines.push("# TYPE harness_task_finish_total counter");
      for (const [key, count] of taskFinish) {
        lines.push(`harness_task_finish_total{${key}} ${count}`);
      }
      lines.push("# HELP harness_abort_total Tasks aborted by reason");
      lines.push("# TYPE harness_abort_total counter");
      for (const [reason, count] of abortsByReason) {
        lines.push(`harness_abort_total{reason="${reason}"} ${count}`);
      }
      lines.push("# HELP harness_tool_results_total Tool executions by outcome");
      lines.push("# TYPE harness_tool_results_total counter");
      for (const [tool, stat] of tools) {
        lines.push(`harness_tool_results_total{tool="${tool}",ok="true"} ${stat.ok}`);
        lines.push(`harness_tool_results_total{tool="${tool}",ok="false"} ${stat.failed}`);
      }
      lines.push(renderHistogram("harness_step_duration_ms", stepDuration));
      lines.push(renderHistogram("harness_task_duration_ms", taskDuration));
      lines.push(renderHistogram("harness_task_total_tokens", taskTokens));
      for (const [name, value] of Object.entries(extraGauges)) {
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${value}`);
      }
      return lines.join("\n") + "\n";
    },
  };
}
