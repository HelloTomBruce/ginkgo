// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RedisMock from "ioredis-mock";
import { InMemoryTaskStore, type TaskSnapshot, type TaskStore } from "./taskStore";
import { FileTaskStore } from "./fileTaskStore";
import { RedisTaskStore } from "./redisTaskStore";
import { SessionStreamHub } from "./streamHub";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function snapshot(sessionKey: string, status: TaskSnapshot["status"] = "running"): TaskSnapshot {
  return {
    sessionKey,
    runId: `run-${sessionKey}`,
    ownerInstanceId: "instance-a:100",
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-task-store-"));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 独立 Node 进程落盘后 SIGKILL，验证恢复不依赖同进程内的新实例或优雅退出钩子。 */
async function crashAfterWrites(
  dir: string,
  task: TaskSnapshot,
  chunks: string[],
  terminalStatus?: "completed"
): Promise<void> {
  const moduleUrl = new URL("./fileTaskStore.ts", import.meta.url).href;
  const script = `
    import { FileTaskStore } from ${JSON.stringify(moduleUrl)};
    const store = new FileTaskStore({ dir: ${JSON.stringify(dir)} });
    const task = ${JSON.stringify(task)};
    await store.create(task);
    for (const chunk of ${JSON.stringify(chunks)}) {
      await store.appendChunk(task.sessionKey, new TextEncoder().encode(chunk));
    }
    const terminalStatus = ${JSON.stringify(terminalStatus ?? null)};
    if (terminalStatus) await store.setStatus(task.sessionKey, terminalStatus);
    console.log("READY");
    setInterval(() => {}, 1000);
  `;
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", "--input-type=module", "--eval", script],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += String(data);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`子进程未及时报告落盘完成：${stderr}`));
    }, 10_000);
    child.stdout.on("data", (data) => {
      if (!String(data).includes("READY")) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code === null) return;
      clearTimeout(timeout);
      reject(new Error(`子进程在 READY 前退出（code=${code}）：${stderr}`));
    });
  });

  const exitPromise = exited;
  child.kill("SIGKILL");
  const result = await exitPromise;
  expect(result.signal).toBe("SIGKILL");
}

const implementations = [
  {
    name: "InMemoryTaskStore",
    create: async () => ({ store: new InMemoryTaskStore(), cleanup: async () => {} }),
  },
  {
    name: "FileTaskStore",
    create: async () => {
      const dir = await makeTempDir();
      return {
        store: new FileTaskStore({ dir }),
        cleanup: async () => fs.rm(dir, { recursive: true, force: true }),
      };
    },
  },
  {
    // ioredis-mock 全局共享同一逻辑 Redis（同 host:port/db 即同上下文）：
    // 每个用例独立 mock client 注入，用例间 flushall 隔离键空间。
    name: "RedisTaskStore(ioredis-mock)",
    create: async () => {
      const client = new RedisMock();
      return {
        store: new RedisTaskStore({ client }),
        cleanup: async () => {
          await client.flushall();
        },
      };
    },
  },
] satisfies {
  name: string;
  create: () => Promise<{ store: TaskStore; cleanup: () => Promise<void> }>; 
}[];

/** Redis 后端的订阅建立是异步往返；内存/文件同步完成，settle 对三者统一无害。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe.each(implementations)("TaskStore 契约：$name", ({ create }) => {
  let store: TaskStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ store, cleanup } = await create());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("create/appendChunk/get/getChunks/runningCount/setStatus/delete 全链路一致", async () => {
    const task = snapshot("tenant-a:sess_contract");
    await store.create(task);
    expect(await store.get(task.sessionKey)).toEqual(task);
    expect(await store.runningCount()).toBe(1);

    await store.appendChunk(task.sessionKey, encoder.encode("chunk-1"));
    await store.appendChunk(task.sessionKey, encoder.encode("chunk-2"));
    const chunks = await store.getChunks(task.sessionKey);
    expect(chunks.map((chunk) => decoder.decode(chunk))).toEqual(["chunk-1", "chunk-2"]);

    await store.setStatus(task.sessionKey, "completed");
    expect(await store.get(task.sessionKey)).toMatchObject({
      sessionKey: task.sessionKey,
      runId: task.runId,
      ownerInstanceId: task.ownerInstanceId,
      createdAt: task.createdAt,
      status: "completed",
    });
    expect(await store.runningCount()).toBe(0);

    await store.delete(task.sessionKey);
    expect(await store.get(task.sessionKey)).toBeUndefined();
    expect(await store.getChunks(task.sessionKey)).toEqual([]);
  });

  it("进程内订阅接收 live chunk 与 1 起单调递增的分块序号，退订后不再接收", async () => {
    const task = snapshot("tenant-a:sess_subscribe");
    await store.create(task);
    const received: Array<{ text: string; seq: number }> = [];
    const unsubscribe = store.subscribeChunks(task.sessionKey, (chunk, seq) => {
      received.push({ text: decoder.decode(chunk), seq });
    });
    await settle();

    await store.appendChunk(task.sessionKey, encoder.encode("live-1"));
    await store.appendChunk(task.sessionKey, encoder.encode("live-2"));
    // Redis 语义：pub/sub 投递是网络往返（异步），消费方不能假设同步送达；
    // 内存/文件实现同步投递，settle 对三者统一无害。
    await settle();
    expect(received).toEqual([
      { text: "live-1", seq: 1 },
      { text: "live-2", seq: 2 },
    ]);

    unsubscribe();
    await store.appendChunk(task.sessionKey, encoder.encode("live-3"));
    expect(received).toHaveLength(2);
  });

  it("任务转入终态时 onClose 回调终态与错误消息，供非 owner 订阅者收尾", async () => {
    const task = snapshot("tenant-a:sess_close");
    await store.create(task);
    const closed: Array<{ status: string; errorMessage?: string }> = [];
    const unsubscribe = store.subscribeChunks(
      task.sessionKey,
      () => {},
      (status, errorMessage) => closed.push({ status, errorMessage })
    );
    await settle();

    await store.setStatus(task.sessionKey, "error", "boom");
    await settle();
    expect(closed).toEqual([{ status: "error", errorMessage: "boom" }]);
    unsubscribe();
  });

  it("publishAbort 广播 sessionKey 与 reason，支持退订", async () => {
    const received: [string, string][] = [];
    const unsubscribe = store.subscribeAbort((sessionKey, reason) => {
      received.push([sessionKey, reason]);
    });
    await settle();

    await store.publishAbort("tenant-a:sess_abort", "user");
    await settle();
    expect(received).toEqual([["tenant-a:sess_abort", "user"]]);
    unsubscribe();
    await store.publishAbort("tenant-a:sess_abort", "timeout");
    expect(received).toEqual([["tenant-a:sess_abort", "user"]]);
  });
});

describe("单机实现的 lease/sweep 为 no-op", () => {
  it.each([
    // 经接口类型调用：具体类型的无参 no-op 实现不影响调用方签名契约
    { name: "InMemoryTaskStore", store: new InMemoryTaskStore() as TaskStore },
  ])("$name：refreshLease 无副作用、sweepOrphans 恒空", async ({ store }) => {
    await store.create(snapshot("tenant-a:sess_lease"));
    await expect(
      store.refreshLease?.("tenant-a:sess_lease", "instance-a:100", 15_000)
    ).resolves.toBeUndefined();
    await expect(store.sweepOrphans?.(async () => false)).resolves.toEqual([]);
    // FileTaskStore 同为 no-op（恢复语义在专属 describe 覆盖），此处一并断言
  });

  it("FileTaskStore：refreshLease 无副作用、sweepOrphans 恒空", async () => {
    const dir = await makeTempDir();
    const store: TaskStore = new FileTaskStore({ dir });
    await store.create(snapshot("tenant-a:sess_lease_file"));
    await expect(
      store.refreshLease?.("tenant-a:sess_lease_file", "instance-a:100", 15_000)
    ).resolves.toBeUndefined();
    await expect(store.sweepOrphans?.(async () => false)).resolves.toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("FileTaskStore 进程重启恢复与终态清理", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("写入 3 个 chunk 后 SIGKILL 进程，重启可重放 completed 任务与全部分块", async () => {
    const task = snapshot("tenant-a:sess_completed");
    await crashAfterWrites(
      dir,
      task,
      ["chunk-1", "chunk-2", "chunk-3"],
      "completed"
    );

    const restarted = new FileTaskStore({ dir });
    expect(await restarted.get(task.sessionKey)).toMatchObject({
      sessionKey: task.sessionKey,
      ownerInstanceId: task.ownerInstanceId,
      status: "completed",
    });
    expect((await restarted.getChunks(task.sessionKey)).map((chunk) => decoder.decode(chunk))).toEqual([
      "chunk-1",
      "chunk-2",
      "chunk-3",
    ]);
    const hub = new SessionStreamHub({ store: restarted });
    const replay = await hub.createResponse("sess_completed", "tenant-a");
    expect(await replay!.text()).toBe("chunk-1chunk-2chunk-3");
  });

  it("重启恢复 running 任务时诚实标记 error: process_restart，保留已写分块", async () => {
    const task = snapshot("tenant-a:sess_running");
    await crashAfterWrites(dir, task, ["before-restart"]);

    const restarted = new FileTaskStore({ dir });
    expect(await restarted.get(task.sessionKey)).toMatchObject({
      status: "error",
      errorMessage: "process_restart",
    });
    expect(decoder.decode((await restarted.getChunks(task.sessionKey))[0])).toBe("before-restart");
    expect(await restarted.runningCount()).toBe(0);

    const hub = new SessionStreamHub({ store: restarted });
    const replay = await hub.createResponse("sess_running", "tenant-a");
    const reader = replay!.body!.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe("before-restart");
    await expect(reader.read()).rejects.toThrow("process_restart");
  });

  it("首行和完整 chunk 后的半写尾行不进入恢复重放", async () => {
    const task = snapshot("tenant-a:sess_partial_tail", "completed");
    const committed = Buffer.from("committed").toString("base64");
    const partialTail = Buffer.from("partial-tail").toString("base64").slice(0, -2);
    await fs.writeFile(
      path.join(dir, `${encodeURIComponent(task.sessionKey)}.ndjson`),
      `${JSON.stringify(task)}\n${committed}\n${partialTail}`,
      "utf8"
    );

    const restarted = new FileTaskStore({ dir });
    expect((await restarted.getChunks(task.sessionKey)).map((chunk) => decoder.decode(chunk))).toEqual([
      "committed",
    ]);
  });

  it("File 写盘中 abort→新任务：等待旧 Reader 收尾，分块与终态不混合", async () => {
    const store = new FileTaskStore({ dir });
    const hub = new SessionStreamHub({ store });
    const appendEntered = deferred();
    const releaseAppend = deferred();
    const originalAppendFile = fs.appendFile.bind(fs);
    let delayed = false;
    const appendSpy = vi.spyOn(fs, "appendFile").mockImplementation(async (file, data, options) => {
      if (!delayed) {
        delayed = true;
        appendEntered.resolve();
        await releaseAppend.promise;
      }
      return originalAppendFile(file, data, options);
    });
    let oldResponse: Response | undefined;

    try {
      const oldRaw = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("old-chunk"));
          },
        })
      );
      oldResponse = await hub.registerAndConsume("sess_file_replace", oldRaw, {
        runId: "run-old-file",
      });
      await appendEntered.promise;
      const createSpy = vi.spyOn(store, "create");
      const newRaw = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("new-chunk"));
            controller.close();
          },
        })
      );
      const newRegistration = hub.registerAndConsume("sess_file_replace", newRaw, {
        runId: "run-new-file",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newCreatedBeforeAppendFinished = createSpy.mock.calls.some(
        ([task]) => task.runId === "run-new-file"
      );
      releaseAppend.resolve();

      const newResponse = await newRegistration;
      expect(newCreatedBeforeAppendFinished).toBe(false);
      expect(await newResponse.text()).toBe("new-chunk");
      expect(await hub.getTask("sess_file_replace")).toMatchObject({
        runId: "run-new-file",
        status: "completed",
      });

      const restarted = new FileTaskStore({ dir });
      expect(await restarted.get("anon:sess_file_replace")).toMatchObject({
        runId: "run-new-file",
        status: "completed",
      });
      expect(
        (await restarted.getChunks("anon:sess_file_replace")).map((chunk) => decoder.decode(chunk))
      ).toEqual(["new-chunk"]);
      createSpy.mockRestore();
    } finally {
      releaseAppend.resolve();
      appendSpy.mockRestore();
      await hub.abortTask("sess_file_replace");
      await oldResponse?.body?.cancel().catch(() => {});
    }
  });

  it("终态保留 30 秒后删除快照与 NDJSON 文件", async () => {
    vi.useFakeTimers();
    const task = snapshot("tenant-a:sess_cleanup");
    const store = new FileTaskStore({ dir });
    await store.create(task);
    await store.appendChunk(task.sessionKey, encoder.encode("chunk"));
    await store.setStatus(task.sessionKey, "completed");
    expect(await store.get(task.sessionKey)).toBeDefined();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await store.get(task.sessionKey)).toBeUndefined();
    // 定时器触发后的 unlink 是真实异步 I/O，切回真实计时器等待其完成。
    vi.useRealTimers();
    await expect.poll(() => fs.readdir(dir)).toEqual([]);
  });
});
