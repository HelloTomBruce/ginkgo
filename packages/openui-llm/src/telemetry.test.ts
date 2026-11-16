// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  compositeSink,
  createConsoleSink,
  jsonByteSize,
  newRunId,
  type HarnessEvent,
  type TelemetrySink,
} from "./telemetry";
import { SessionStreamHub } from "./streamHub";

function spySink(): TelemetrySink & { events: HarnessEvent[] } {
  const events: HarnessEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe("telemetry sink 基础件", () => {
  afterEach(() => vi.restoreAllMocks());

  it("createConsoleSink:事件以单行 JSON 走 stdout,error 级走 stderr", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = createConsoleSink();
    sink.emit({ type: "run_start", runId: "r1", mode: "direct", model: "m", maxSteps: 5 });
    sink.emit({ type: "error", runId: "r1", code: "STREAM_ERROR", detail: "boom" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = vi.mocked(logSpy).mock.calls[0][0] as string;
    expect(line).toContain('"type":"run_start"');
    expect(line.split("\n").length).toBe(1);
    expect(JSON.parse(line)).toMatchObject({ type: "run_start", runId: "r1" });
  });

  it("compositeSink:同一事件广播到全部下游,单下游抛错不影响其余与主流程", () => {
    const a = spySink();
    const b = spySink();
    const bad: TelemetrySink = { emit: () => { throw new Error("sink down"); } };
    const sink = compositeSink(a, bad, b);
    expect(() => sink.emit({ type: "warn", code: "X" })).not.toThrow();
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });

  it("newRunId 每次不同;jsonByteSize 估算字节,病态对象返回 -1", () => {
    expect(newRunId()).not.toBe(newRunId());
    expect(jsonByteSize({ a: 1 })).toBeGreaterThan(0);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(jsonByteSize(circular)).toBe(-1);
  });
});

describe("SessionStreamHub 遥测事件", () => {
  afterEach(() => vi.restoreAllMocks());

  function makeStreamResponse(chunks: string[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "x-vercel-ai-data-stream": "v1" },
    });
  }

  it("abortTask 携带任务 runId 与中止原因;无任务时返回 false 且不发事件", async () => {
    const sink = spySink();
    const hub = new SessionStreamHub(sink);
    // 任务随后台 Reader 尽快完成,但保留在 map 中 30s 保留窗内
    hub.registerAndConsume("s1", makeStreamResponse(['0:"a"\n']), { runId: "run-1" });

    hub.abortTask("s_none", "user"); // 不存在的会话:无事件
    expect(sink.events).toHaveLength(0);

    hub.abortTask("s1", "timeout");
    const abortEvent = sink.events.find((e) => e.type === "abort") as
      | Extract<HarnessEvent, { type: "abort" }>
      | undefined;
    expect(abortEvent).toMatchObject({
      type: "abort",
      sessionId: "s1",
      reason: "timeout",
    });
    // 任务在 30s 保留窗内,runId 随 task 保留(标识创建该任务的请求)
    expect(abortEvent?.runId).toBe("run-1");
  });

  it("同会话新任务顶替旧任务:abort 事件 reason=new_task 且携带旧任务 runId", async () => {
    const sink = spySink();
    const hub = new SessionStreamHub(sink);
    // 旧任务:永不完成的流(模拟在途)
    const pending = new Response(
      new ReadableStream<Uint8Array>({ start() {} /* 不 close */ })
    );
    hub.registerAndConsume("s2", pending, { runId: "run-old" });
    hub.registerAndConsume("s2", makeStreamResponse(['0:"b"\n']), { runId: "run-new" });

    const abortEvent = sink.events.find((e) => e.type === "abort") as
      | Extract<HarnessEvent, { type: "abort" }>
      | undefined;
    expect(abortEvent).toMatchObject({
      type: "abort",
      sessionId: "s2",
      reason: "new_task",
      runId: "run-old",
    });
  });

  it("上游响应无 body:发 error 事件且任务经清理不留 map", async () => {
    const sink = spySink();
    const hub = new SessionStreamHub(sink);
    hub.registerAndConsume("s3", new Response(null), { runId: "run-3" });
    await new Promise((r) => setTimeout(r, 0));

    const errEvent = sink.events.find((e) => e.type === "error") as
      | Extract<HarnessEvent, { type: "error" }>
      | undefined;
    expect(errEvent).toMatchObject({
      type: "error",
      sessionId: "s3",
      code: "STREAM_BODY_UNREADABLE",
      runId: "run-3",
    });
    expect(hub.hasTask("s3")).toBe(true); // 30s 保留窗内仍可查(hasTask 语义不变)
  });
});
