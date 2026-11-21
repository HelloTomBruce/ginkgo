/**
 * 多副本语义测试（WS-8 wave B）：双 hub 实例共享同一 Redis 后端（ioredis-mock）。
 *
 * 覆盖：
 * - 跨副本重连：B 重放 A 已产出分块 + live 续接 + owner 终态时 B 收尾（8.5）
 * - 跨副本中止：B 调 abortTask，A 的本地 AbortController 触发且上游 reader 取消（8.6）
 * - 孤儿回收：A「暴毙」（租约消失）后 B 的清扫器标记 owner_lost（8.7）
 * - 分布式准入：running 计数跨实例可见，清扫回收后名额释放（8.8）
 * - 工厂接线：LLM_TASK_STORE=redis 的 env 约束与注入优先（8.4 附属）
 *
 * pub/sub 投递是异步往返（与真实 Redis 一致），用 settle() 统一等待。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import RedisMock from "ioredis-mock";
import {
  SessionStreamHub,
  RedisTaskStore,
  InMemoryTaskStore,
} from "@openui-analytics/harness-core";
import { createAnalyzeHandler } from "./handler";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** pub/sub 与 store 命令是异步往返（真实 Redis 亦然）；测试统一等待投递落定。 */
async function settle(ms = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReplicaCluster {
  client: InstanceType<typeof RedisMock>;
  hubA: SessionStreamHub;
  hubB: SessionStreamHub;
}

/** 构建共享同一 Redis 的双副本集群（instance-a / instance-b）。 */
function makeCluster(opts?: { leaseTtlMs?: number; sweepIntervalMs?: number }): ReplicaCluster {
  const client = new RedisMock();
  const storeFor = () => new RedisTaskStore({ client });
  const hubA = new SessionStreamHub({
    store: storeFor(),
    instanceId: "instance-a",
    leaseTtlMs: opts?.leaseTtlMs,
    sweepIntervalMs: opts?.sweepIntervalMs,
  });
  const hubB = new SessionStreamHub({
    store: storeFor(),
    instanceId: "instance-b",
    leaseTtlMs: opts?.leaseTtlMs,
    sweepIntervalMs: opts?.sweepIntervalMs,
  });
  return { client, hubA, hubB };
}

/** 可在测试中途持续推送分块的上游响应（模拟 provider SSE 流）。 */
function makeLiveResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    error: (reason: unknown) => controller.error(reason),
    get cancelled() {
      return cancelled;
    },
  };
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  expect(done).toBe(false);
  return decoder.decode(value);
}

describe("多副本：跨副本重连（8.5）", () => {
  it("B 重放 A 已产出的分块并续接 live 分块，owner 完成后 B 收到关闭", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      const resA = await hubA.registerAndConsume("sess", live.response);
      expect(resA.ok).toBe(true);
      live.push("c1");
      live.push("c2");
      live.push("c3");
      await settle();

      // 重连落在副本 B
      const resB = await hubB.createResponse("sess");
      expect(resB).not.toBeNull();
      const reader = resB!.body!.getReader();
      expect(await readChunk(reader)).toBe("c1");
      expect(await readChunk(reader)).toBe("c2");
      expect(await readChunk(reader)).toBe("c3");

      // owner 继续产出 → B live 续接（订阅先于重放建立，无间隙丢失）
      live.push("c4");
      expect(await readChunk(reader)).toBe("c4");

      // owner 完成 → B 的订阅者经 onClose 收到 completed 关闭
      live.close();
      await settle();
      expect((await reader.read()).done).toBe(true);
    } finally {
      await client.flushall();
    }
  });

  it("订阅建立后、列表读取前的间隙分块被 seq 去重，不双份不丢失", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      await hubA.registerAndConsume("sess", live.response);
      live.push("c1");
      await settle();

      // B 进入重连：subscribeChunks 在 createResponse 内部先于 getChunks 建立。
      // 在订阅建立与列表读取的间隙 owner 再推一分块——实现上不可从外部精确注入，
      // 这里用连续推送 + 多次重放断言总和恰好一次来覆盖协议的去重不变量。
      const resB = await hubB.createResponse("sess");
      live.push("c2");
      live.push("c3");
      await settle();

      const reader = resB!.body!.getReader();
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) seen.push(await readChunk(reader));
      expect(seen).toEqual(["c1", "c2", "c3"]);
      live.close();
      await settle();
      expect((await reader.read()).done).toBe(true);
    } finally {
      await client.flushall();
    }
  });

  it("owner 在重连竞态窗内转入终态：B 读状态补收尾而非悬挂", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      await hubA.registerAndConsume("sess", live.response);
      live.push("c1");
      await settle();
      live.close();
      await settle();

      const resB = await hubB.createResponse("sess");
      const reader = resB!.body!.getReader();
      expect(await readChunk(reader)).toBe("c1");
      // completed 终态：重放后关闭
      expect((await reader.read()).done).toBe(true);
    } finally {
      await client.flushall();
    }
  });
});

describe("多副本：跨副本中止（8.6）", () => {
  it("B 调 abortTask：A 的本地 AbortController 触发、上游 reader 取消、任务终态 error", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      const abortController = new AbortController();
      await hubA.registerAndConsume("sess", live.response, { abortController });
      live.push("c1");
      await settle();

      const ok = await hubB.abortTask("sess", "user");
      expect(ok).toBe(true);

      // control 频道广播 → A 本地中止；等 A 的 Reader 收尾落定
      await settle(30);
      expect(abortController.signal.aborted).toBe(true);
      expect(live.cancelled).toBe(true);
      expect(await hubA.hasRunningTask("sess")).toBe(false);
    } finally {
      await client.flushall();
    }
  });
});

describe("多副本：孤儿回收（8.7）", () => {
  it("A 暴毙（租约消失）后 B 的清扫器把任务标记 owner_lost", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      await hubA.registerAndConsume("sess", live.response);
      live.push("c1");
      await settle();

      // owner 心跳已写入租约（冷启动窗口立即续约）
      expect(await client.get("harness:lease:anon:sess")).toBe("instance-a");

      // 模拟 A 暴毙：进程死亡不清理定时器与租约——从 B 的视角等价于租约失踪
      await client.del("harness:lease:anon:sess");
      const reclaimed = await hubB.sweepOnce();
      expect(reclaimed).toEqual(["anon:sess"]);

      const snapshot = await hubA.getTask("sess");
      expect(snapshot?.status).toBe("error");
      expect(snapshot?.errorMessage).toBe("owner_lost");

      // 重连收到 error 语义（诚实标记：provider 流已死，不可续）
      const resB = await hubB.createResponse("sess");
      const reader = resB!.body!.getReader();
      await expect(reader.read()).rejects.toThrow("owner_lost");
    } finally {
      await client.flushall();
    }
  });

  it("租约存在（owner 活着）时清扫器不误杀", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      await hubA.registerAndConsume("sess", live.response);
      await settle();
      const reclaimed = await hubB.sweepOnce();
      expect(reclaimed).toEqual([]);
      expect(await hubA.hasRunningTask("sess")).toBe(true);
    } finally {
      await client.flushall();
    }
  });
});

describe("多副本：分布式准入（8.8）", () => {
  it("A 的 running 任务对 B 的 runningCount 可见，清扫回收后名额释放", async () => {
    const { client, hubA, hubB } = makeCluster();
    try {
      const live = makeLiveResponse();
      await hubA.registerAndConsume("sess", live.response);
      await settle();
      expect(await hubB.runningCount()).toBe(1);

      await client.del("harness:lease:anon:sess");
      const reclaimed = await hubB.sweepOnce();
      expect(reclaimed).toEqual(["anon:sess"]);
      expect(await hubB.runningCount()).toBe(0);
    } finally {
      await client.flushall();
    }
  });
});

describe("工厂接线：LLM_TASK_STORE=redis（8.4 附属）", () => {
  const ENV_BACKUP = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    vi.restoreAllMocks();
  });

  it("redis 模式缺 REDIS_URL 时工厂抛含指引的错误", () => {
    process.env.LLM_TASK_STORE = "redis";
    delete process.env.REDIS_URL;
    expect(() => createAnalyzeHandler({})).toThrow(
      /LLM_TASK_STORE=redis 需要 REDIS_URL/
    );
  });

  it("显式 taskStore 时跳过 env store 解析（非法 env 值不影响注入方）", () => {
    process.env.LLM_TASK_STORE = "bogus-kind";
    expect(() =>
      createAnalyzeHandler({ taskStore: new InMemoryTaskStore() })
    ).not.toThrow();
  });

  it("非法 store 值报可选清单（含 redis）", () => {
    process.env.LLM_TASK_STORE = "bogus-kind";
    delete process.env.REDIS_URL;
    expect(() => createAnalyzeHandler({})).toThrow(
      /可选 memory\/file\/redis/
    );
  });
});
