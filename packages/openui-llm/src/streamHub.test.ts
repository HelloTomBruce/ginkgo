import { describe, it, expect, vi } from "vitest";
import { SessionStreamHub } from "./streamHub";
import { InMemoryTaskStore } from "./taskStore";
import type { HarnessEvent } from "./telemetry";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeFakeStreamResponse(chunks: string[], delayMs = 10): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": "v1",
    },
  });
}

async function collectStreamText(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("SessionStreamHub", () => {
  it("首个订阅者接收完整流数据", async () => {
    const hub = new SessionStreamHub();
    const raw = makeFakeStreamResponse(['0:"hello"\n', '0:" world"\n'], 5);

    const subResponse = await hub.registerAndConsume("sess_1", raw);
    expect(await hub.hasRunningTask("sess_1")).toBe(true);

    const result = await collectStreamText(subResponse);
    expect(result).toBe('0:"hello"\n0:" world"\n');
    expect(await hub.hasRunningTask("sess_1")).toBe(false);
  });

  it("客户端中途刷新（创建新订阅）：重放历史 chunk 并继续接收后续 live 数据", async () => {
    const hub = new SessionStreamHub();
    const raw = makeFakeStreamResponse(
      ['0:"chunk1"\n', '0:"chunk2"\n', '0:"chunk3"\n', '0:"chunk4"\n'],
      20
    );

    const sub1 = await hub.registerAndConsume("sess_reconn", raw);

    // 模拟 sub1 收到前 2 个 chunk 后断开连接（页面刷新）
    const reader1 = sub1.body!.getReader();
    const decoder = new TextDecoder();
    let text1 = "";
    const firstChunk = await reader1.read();
    text1 += decoder.decode(firstChunk.value);
    await reader1.cancel(); // 浏览器刷新，断开连接

    expect(text1).toContain('0:"chunk1"');

    // 页面刷新后重新接入（reconnect）
    expect(await hub.hasRunningTask("sess_reconn")).toBe(true);
    const sub2 = (await hub.createResponse("sess_reconn"))!;
    expect(sub2).toBeDefined();

    // sub2 应当接收到全量的 chunk（重放 + 后续 live）
    const text2 = await collectStreamText(sub2);
    expect(text2).toBe('0:"chunk1"\n0:"chunk2"\n0:"chunk3"\n0:"chunk4"\n');
  });

  it("支持显式中止任务 abortTask", async () => {
    const hub = new SessionStreamHub();
    const raw = makeFakeStreamResponse(
      ['0:"c1"\n', '0:"c2"\n', '0:"c3"\n', '0:"c4"\n'],
      50
    );

    await hub.registerAndConsume("sess_abort", raw);
    expect(await hub.hasRunningTask("sess_abort")).toBe(true);

    // 等待第一个 chunk 输出
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 用户在前端点击中止
    const stopped = await hub.abortTask("sess_abort");
    expect(stopped).toBe(true);
    expect(await hub.hasRunningTask("sess_abort")).toBe(false);
  });

  it("中止时上游 reader 阻塞在 read() 也能即刻取消（不等待下一个 chunk）", async () => {
    const hub = new SessionStreamHub();
    let upstreamCancelled = false;
    // 永不产出数据、也不结束的上游（模拟 LLM 慢思考/hang 住）
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // 故意不 enqueue 任何数据
      },
      cancel() {
        upstreamCancelled = true;
      },
    });

    await hub.registerAndConsume("sess_hang", new Response(stream));
    expect(await hub.hasRunningTask("sess_hang")).toBe(true);

    // reader 正阻塞在 read() 时中止
    const stopped = await hub.abortTask("sess_hang");
    expect(stopped).toBe(true);

    // cancelUpstream 被调用，上游收到取消（abort 不再依赖下一个 chunk 到来）
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(upstreamCancelled).toBe(true);
    expect(await hub.hasRunningTask("sess_hang")).toBe(false);
  });

  it("上游响应无 body：任务转入 error 并统一清理，不滞留 map", async () => {
    // 先装 fake timers，让 scheduleCleanup 的 setTimeout 可被推进
    vi.useFakeTimers();
    try {
      const hub = new SessionStreamHub();
      // Response(null) 的 body 为 null
      await hub.registerAndConsume("sess_nobody", new Response(null));

      const task = await hub.getTask("sess_nobody");
      expect(task).toBeDefined();
      expect(task?.status).toBe("error");

      // 首个订阅者拿到的是 error 流（而非挂起）
      const sub = (await hub.createResponse("sess_nobody"))!;
      await expect(collectStreamText(sub)).rejects.toThrow();

      // 30 秒后自动清理
      vi.advanceTimersByTime(31000);
      expect(await hub.hasTask("sess_nobody")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("共享快照写入注入的 ownerInstanceId，运行时对象仍不进 TaskStore", async () => {
    const hub = new SessionStreamHub({ instanceId: "instance-test:123" });
    const stuck = new Response(new ReadableStream<Uint8Array>({ start() {} }));
    await hub.registerAndConsume("sess_owner", stuck, { runId: "run-owner" });

    const task = await hub.getTask("sess_owner");
    expect(task).toMatchObject({
      sessionKey: "anon:sess_owner",
      runId: "run-owner",
      ownerInstanceId: "instance-test:123",
      status: "running",
    });
    expect(task).not.toHaveProperty("abortController");
    expect(task).not.toHaveProperty("subscribers");
    await hub.abortTask("sess_owner");
  });

  it("同会话新任务顶替后，旧任务的 30 秒清理定时器不得误删新任务", async () => {
    vi.useFakeTimers();
    try {
      const hub = new SessionStreamHub();
      await hub.registerAndConsume(
        "sess_replace",
        new Response(new ReadableStream<Uint8Array>({ start() {} }))
      );
      await hub.registerAndConsume(
        "sess_replace",
        new Response(new ReadableStream<Uint8Array>({ start() {} }))
      );

      await vi.advanceTimersByTimeAsync(31_000);
      expect(await hub.hasRunningTask("sess_replace")).toBe(true);
      await hub.abortTask("sess_replace");
    } finally {
      vi.useRealTimers();
    }
  });
  it("同 sessionKey 并发注册按调用顺序串行，旧任务不得覆盖新任务", async () => {
    const store = new InMemoryTaskStore();
    const hub = new SessionStreamHub({ store });
    const oldCreateEntered = deferred();
    const releaseOldCreate = deferred();
    const originalCreate = store.create.bind(store);
    const createSpy = vi.spyOn(store, "create").mockImplementation(async (task) => {
      if (task.runId === "run-old") {
        oldCreateEntered.resolve();
        await releaseOldCreate.promise;
      }
      await originalCreate(task);
    });
    const oldRaw = new Response(new ReadableStream<Uint8Array>({ start() {} }));
    let oldResponse: Response | undefined;

    try {
      const oldRegistration = hub.registerAndConsume("sess_concurrent", oldRaw, {
        runId: "run-old",
      });
      await oldCreateEntered.promise;
      const newRegistration = hub.registerAndConsume(
        "sess_concurrent",
        makeFakeStreamResponse(["new"], 0),
        { runId: "run-new" }
      );
      // 给未串行化的实现一次抢跑 create(run-new) 的机会。
      await new Promise((resolve) => setTimeout(resolve, 10));
      releaseOldCreate.resolve();
      const [oldResult, newResult] = await Promise.all([oldRegistration, newRegistration]);
      oldResponse = oldResult;

      expect(await newResult.text()).toBe("new");
      expect(await hub.getTask("sess_concurrent")).toMatchObject({
        runId: "run-new",
        status: "completed",
      });
      await expect(oldResult.text()).rejects.toThrow("Stream error");
    } finally {
      createSpy.mockRestore();
      await hub.abortTask("sess_concurrent");
      await oldResponse?.body?.cancel().catch(() => {});
    }
  });

  it("appendChunk 与 setStatus 连续失败时仍关闭订阅并清理看门狗，不留 unhandled rejection", async () => {
    vi.useFakeTimers();
    try {
      class DiskFullStore extends InMemoryTaskStore {
        override async appendChunk(): Promise<void> {
          throw new Error("disk full: append");
        }
        override async setStatus(): Promise<void> {
          throw new Error("disk full: status");
        }
      }
      const events: HarnessEvent[] = [];
      const hub = new SessionStreamHub({
        store: new DiskFullStore(),
        sink: { emit: (event) => events.push(event) },
      });
      const response = await hub.registerAndConsume(
        "sess_disk_full",
        makeFakeStreamResponse(["chunk"], 0)
      );

      await expect(response.text()).rejects.toThrow("disk full: append");
      expect(events.some((event) => event.type === "error" && event.code === "READER_ERROR")).toBe(
        true
      );
      // 仅余 30 秒清理定时器；看门狗和 lease 心跳均已清除。
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(31_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("无 body 且 setStatus 失败时仍执行本地 error 收尾", async () => {
    vi.useFakeTimers();
    try {
      class StatusFailureStore extends InMemoryTaskStore {
        override async setStatus(): Promise<void> {
          throw new Error("disk full: status");
        }
      }
      const hub = new SessionStreamHub({ store: new StatusFailureStore() });
      const response = await hub.registerAndConsume("sess_nobody_disk_full", new Response(null));

      await expect(response.text()).rejects.toThrow("Upstream response has no body");
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(31_000);
    } finally {
      vi.useRealTimers();
    }
  }, 1000);

  it("默认内存自然 error 重连保持原行为：首读直接 error，不新增历史分块重放", async () => {
    const hub = new SessionStreamHub();
    const raw = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
          controller.error(new Error("natural failure"));
        },
      })
    );
    const initial = await hub.registerAndConsume("sess_natural_error", raw);
    await expect(initial.text()).rejects.toThrow("natural failure");

    const replay = (await hub.createResponse("sess_natural_error"))!;
    await expect(replay.body!.getReader().read()).rejects.toThrow("natural failure");
  });
});

describe("SessionStreamHub 任务级看门狗（WS-2）", () => {
  it("任务超过 taskTimeoutMs 未完成：自动中止，abort 事件 reason=timeout", async () => {
    vi.useFakeTimers();
    try {
      const events: HarnessEvent[] = [];
      // 35s 在钳制边界[30s, 60min]内,不经收敛,便于精确推进
      const hub = new SessionStreamHub({
        sink: { emit: (e) => events.push(e) },
        taskTimeoutMs: 35_000,
      });
      // 永不产出、永不结束的上游（模拟 provider 挂起）
      const stuck = new Response(new ReadableStream<Uint8Array>({ start() {} }));
      await hub.registerAndConsume("sess_watchdog", stuck, { runId: "run-wd" });
      expect(await hub.hasRunningTask("sess_watchdog")).toBe(true);

      // abortTask 现在需要等待 TaskStore 写入，推进定时器也排空其异步收尾。
      await vi.advanceTimersByTimeAsync(36_000);

      expect(await hub.hasRunningTask("sess_watchdog")).toBe(false);
      const abortEvent = events.find((e) => e.type === "abort") as
        | Extract<HarnessEvent, { type: "abort" }>
        | undefined;
      expect(abortEvent).toMatchObject({
        type: "abort",
        sessionId: "sess_watchdog",
        reason: "timeout",
        runId: "run-wd",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("任务正常完成：看门狗清除，超时不误伤（终态仍在 30s 保留窗）", async () => {
    vi.useFakeTimers();
    try {
      const events: HarnessEvent[] = [];
      const hub = new SessionStreamHub({
        sink: { emit: (e) => events.push(e) },
        taskTimeoutMs: 5000,
      });
      await hub.registerAndConsume(
        "sess_ok",
        makeFakeStreamResponse(['0:"a"\n'], 0),
        { runId: "run-ok" }
      );
      // 推进假定时器并排空微任务，让后台 Reader 消费完流
      await vi.advanceTimersByTimeAsync(100);
      expect(await hub.hasRunningTask("sess_ok")).toBe(false);

      // 越过看门狗时限:不得对已完成任务发 abort
      vi.advanceTimersByTime(10000);
      expect(events.filter((e) => e.type === "abort")).toHaveLength(0);
      expect(await hub.hasTask("sess_ok")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("taskTimeoutMs 钳制:低于下限 30s 的配置被收敛,5s 时不得提前中止", async () => {
    vi.useFakeTimers();
    try {
      const hub = new SessionStreamHub({ taskTimeoutMs: 1 });
      const stuck = new Response(new ReadableStream<Uint8Array>({ start() {} }));
      await hub.registerAndConsume("sess_clamp", stuck);
      vi.advanceTimersByTime(5000);
      expect(await hub.hasRunningTask("sess_clamp")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("外部注入 abortController:abortTask 后同一 signal 被触发（handler 借此传导进 streamText）", async () => {
    const hub = new SessionStreamHub();
    const controller = new AbortController();
    const stuck = new Response(new ReadableStream<Uint8Array>({ start() {} }));
    await hub.registerAndConsume("sess_signal", stuck, { abortController: controller });

    await hub.abortTask("sess_signal", "user");
    expect(controller.signal.aborted).toBe(true);
    expect(await hub.hasRunningTask("sess_signal")).toBe(false);
  });
});
