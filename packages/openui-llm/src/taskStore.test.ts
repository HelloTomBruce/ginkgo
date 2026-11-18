// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTaskStore, type TaskSnapshot, type TaskStore } from "./taskStore";
import { FileTaskStore } from "./fileTaskStore";
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
] satisfies {
  name: string;
  create: () => Promise<{ store: TaskStore; cleanup: () => Promise<void> }>;
}[];

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

  it("进程内订阅接收 live chunk，退订后不再接收", async () => {
    const task = snapshot("tenant-a:sess_subscribe");
    await store.create(task);
    const received: string[] = [];
    const unsubscribe = store.subscribeChunks(task.sessionKey, (chunk) => {
      received.push(decoder.decode(chunk));
    });

    await store.appendChunk(task.sessionKey, encoder.encode("live-1"));
    unsubscribe();
    await store.appendChunk(task.sessionKey, encoder.encode("live-2"));
    expect(received).toEqual(["live-1"]);
  });

  it("publishAbort 广播 sessionKey 与 reason，支持退订", async () => {
    const received: [string, string][] = [];
    const unsubscribe = store.subscribeAbort((sessionKey, reason) => {
      received.push([sessionKey, reason]);
    });

    await store.publishAbort("tenant-a:sess_abort", "user");
    unsubscribe();
    await store.publishAbort("tenant-a:sess_abort", "timeout");
    expect(received).toEqual([["tenant-a:sess_abort", "user"]]);
  });

  it("单机实现的 lease/sweep 为 no-op", async () => {
    await store.create(snapshot("tenant-a:sess_lease"));
    await expect(
      store.refreshLease?.("tenant-a:sess_lease", "instance-a:100", 15_000)
    ).resolves.toBeUndefined();
    await expect(store.sweepOrphans?.(async () => false)).resolves.toEqual([]);
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
