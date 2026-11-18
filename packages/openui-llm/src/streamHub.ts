/**
 * 会话流中继中枢（SessionStreamHub）：
 * 实现服务端与客户端生命周期解耦的后台流式任务管理。
 *
 * 本地 Map 只保存 owner 侧运行时对象（AbortController、订阅者、上游 Reader 取消器）；
 * 可共享的任务快照与分块全部经 TaskStore 存取，内存/文件/多副本后端可替换。
 */

import { hostname } from "node:os";
import { InMemoryTaskStore, type TaskSnapshot, type TaskStatus, type TaskStore } from "./taskStore";
import type { AbortReason, RunId, TelemetrySink } from "./telemetry";
import { createConsoleSink } from "./telemetry";

export interface StreamSubscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

/** 对外只读任务视图：共享快照加重连所需的历史分块，不暴露 owner 运行时对象。 */
export interface SessionStreamTask extends TaskSnapshot {
  sessionId: string;
  chunks: Uint8Array[];
}

interface OwnedStreamTask {
  sessionKey: string;
  sessionId: string;
  runId?: RunId;
  subscribers: Set<StreamSubscriber>;
  abortController: AbortController;
  /** 中止时立即取消上游 reader，解除 read() 阻塞并停止 provider 继续计费 */
  cancelUpstream?: () => Promise<void>;
  /** 任务级看门狗与租约心跳均在终态清除 */
  deadlineTimer?: ReturnType<typeof setTimeout>;
  leaseTimer?: ReturnType<typeof setInterval>;
}

/** 缺省租户：未注入 authenticate 时所有请求归入同一匿名租户 */
export const DEFAULT_TENANT_ID = "anon";

/** WS-10 多租户存储键：tenantId 命名空间隔离 sessionId（拼键唯一入口，调用方只传分离值） */
export function sessionStorageKey(sessionId: string, tenantId?: string): string {
  return `${tenantId ?? DEFAULT_TENANT_ID}:${sessionId}`;
}

/** 任务级看门狗超时的钳制边界 */
const TASK_TIMEOUT_MIN_MS = 30_000;
const TASK_TIMEOUT_MAX_MS = 3_600_000;
const TASK_TIMEOUT_DEFAULT_MS = 600_000;
const TERMINAL_RETENTION_MS = 30_000;
const LEASE_REFRESH_INTERVAL_MS = 5_000;
const LEASE_TTL_MS = 15_000;

export interface SessionStreamHubOptions {
  sink?: TelemetrySink;
  /** 任务 wall-clock 上限；缺省读 env LLM_TASK_TIMEOUT_MS，再缺省 10 分钟 */
  taskTimeoutMs?: number;
  /** 共享状态存储；缺省保持进程内 Map 语义 */
  store?: TaskStore;
  /** owner 标识；多副本部署应注入稳定且唯一的实例 id */
  instanceId?: string;
}

export class SessionStreamHub {
  /** 仅 owner 侧进程内运行时对象；任务状态与 chunks 不在此镜像。 */
  private readonly tasks = new Map<string, OwnedStreamTask>();
  private readonly taskTimeoutMs: number;
  private readonly sink: TelemetrySink;
  private readonly store: TaskStore;
  private readonly instanceId: string;

  constructor(opts: SessionStreamHubOptions = {}) {
    this.sink = opts.sink ?? createConsoleSink();
    this.store = opts.store ?? new InMemoryTaskStore();
    this.instanceId = opts.instanceId ?? `${hostname()}:${process.pid}`;
    const envMs = Number(process.env.LLM_TASK_TIMEOUT_MS);
    const envValid = Number.isFinite(envMs) && envMs > 0;
    this.taskTimeoutMs = Math.min(
      Math.max(
        opts.taskTimeoutMs ?? (envValid ? envMs : TASK_TIMEOUT_DEFAULT_MS),
        TASK_TIMEOUT_MIN_MS
      ),
      TASK_TIMEOUT_MAX_MS
    );

    // 非 owner 只发布 abort；真正的 AbortController/上游 Reader 由 owner 在此回调中处理。
    this.store.subscribeAbort((sessionKey, reason) => {
      const task = this.tasks.get(sessionKey);
      if (!task) return;
      void this.abortOwnedTask(task, reason).catch(() => {});
    });
  }

  async hasRunningTask(sessionId: string, tenantId?: string): Promise<boolean> {
    const snapshot = await this.store.get(sessionStorageKey(sessionId, tenantId));
    return snapshot?.status === "running";
  }

  async hasTask(sessionId: string, tenantId?: string): Promise<boolean> {
    return (await this.store.get(sessionStorageKey(sessionId, tenantId))) !== undefined;
  }

  async getTask(sessionId: string, tenantId?: string): Promise<SessionStreamTask | undefined> {
    const sessionKey = sessionStorageKey(sessionId, tenantId);
    const snapshot = await this.store.get(sessionKey);
    if (!snapshot) return undefined;
    return {
      ...snapshot,
      sessionId,
      chunks: await this.store.getChunks(sessionKey),
    };
  }

  /** 当前 running 状态的任务数（并发准入的计数来源，多副本后端可给全局值） */
  async runningCount(): Promise<number> {
    return this.store.runningCount();
  }

  async abortTask(
    sessionId: string,
    reason: AbortReason = "user",
    tenantId?: string
  ): Promise<boolean> {
    const sessionKey = sessionStorageKey(sessionId, tenantId);
    const snapshot = await this.store.get(sessionKey);
    if (!snapshot) return false;

    const task = this.tasks.get(sessionKey);
    if (task) await this.abortOwnedTask(task, reason);
    // owner 走现状本地 abort；非 owner 仅广播，由 owner 的 subscribeAbort 回调执行。
    await this.store.publishAbort(sessionKey, reason);
    return true;
  }

  /** 为当前任务创建 HTTP 响应流：重放历史分块，running 任务再续接 live 分块。 */
  async createResponse(sessionId: string, tenantId?: string): Promise<Response | null> {
    const sessionKey = sessionStorageKey(sessionId, tenantId);
    const snapshot = await this.store.get(sessionKey);
    if (!snapshot) return null;
    const chunks = await this.store.getChunks(sessionKey);
    const ownedTask = this.tasks.get(sessionKey);

    let subscriber: StreamSubscriber | null = null;
    let unsubscribeChunks: (() => void) | undefined;
    let errorReplayIndex = 0;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // error() 会立即丢弃已排队分块；error 终态改在 pull 中逐块重放后再抛错。
        if (snapshot.status === "error") return;
        for (const chunk of chunks) controller.enqueue(chunk);
        if (snapshot.status === "completed") {
          controller.close();
          return;
        }

        if (ownedTask) {
          // owner 的后台 Reader 已直接广播给本地订阅者，不能再订阅 store 否则双发。
          subscriber = { controller };
          ownedTask.subscribers.add(subscriber);
        } else {
          // 非 owner 通过 store 重放并续接；同一进程双 hub 与后续 Redis 后端共用此路径。
          unsubscribeChunks = this.store.subscribeChunks(sessionKey, (chunk) => {
            try {
              controller.enqueue(chunk);
            } catch {
              unsubscribeChunks?.();
            }
          });
        }
      },
      pull: (controller) => {
        if (snapshot.status !== "error") return;
        if (errorReplayIndex < chunks.length) {
          controller.enqueue(chunks[errorReplayIndex++]);
          return;
        }
        controller.error(new Error(snapshot.errorMessage ?? "Stream terminated"));
      },
      cancel: () => {
        if (subscriber && ownedTask) ownedTask.subscribers.delete(subscriber);
        unsubscribeChunks?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "x-vercel-ai-data-stream": "v1",
      },
    });
  }

  /**
   * 注册原始流并启动 owner 侧后台 Reader。meta.abortController 与 handler 的 streamText
   * 共用，使用户停止/看门狗超时可真正取消 provider 生成。
   */
  async registerAndConsume(
    sessionId: string,
    rawResponse: Response,
    meta?: { runId?: RunId; abortController?: AbortController; tenantId?: string }
  ): Promise<Response> {
    const tenantId = meta?.tenantId ?? DEFAULT_TENANT_ID;
    const sessionKey = sessionStorageKey(sessionId, tenantId);
    if (await this.hasRunningTask(sessionId, tenantId)) {
      await this.abortTask(sessionId, "new_task", tenantId);
    }

    const now = Date.now();
    await this.store.create({
      sessionKey,
      runId: meta?.runId,
      ownerInstanceId: this.instanceId,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });

    const task: OwnedStreamTask = {
      sessionKey,
      sessionId,
      runId: meta?.runId,
      subscribers: new Set(),
      abortController: meta?.abortController ?? new AbortController(),
    };
    this.tasks.set(sessionKey, task);

    task.deadlineTimer = setTimeout(() => {
      void this.abortTask(sessionId, "timeout", tenantId).catch(() => {});
    }, this.taskTimeoutMs);
    this.unrefTimer(task.deadlineTimer);
    if (this.store.refreshLease) {
      task.leaseTimer = setInterval(() => {
        void this.store.refreshLease?.(sessionKey, this.instanceId, LEASE_TTL_MS).catch(() => {});
      }, LEASE_REFRESH_INTERVAL_MS);
      this.unrefTimer(task.leaseTimer);
    }

    void (async () => {
      const reader = rawResponse.body?.getReader();
      if (!reader) {
        const error = new Error("Upstream response has no body");
        await this.store.setStatus(sessionKey, "error", error.message);
        this.sink.emit({
          type: "error",
          runId: task.runId,
          sessionId,
          code: "STREAM_BODY_UNREADABLE",
          detail: "rawResponse.body is not readable; terminating task",
        });
        this.clearTimers(task);
        this.closeSubscribers(task, "error", error);
        this.scheduleCleanup(task);
        return;
      }

      task.cancelUpstream = async () => {
        await reader.cancel().catch(() => {});
      };
      let terminalStatus: TaskStatus = "running";
      let terminalError: unknown;
      try {
        while (true) {
          if (task.abortController.signal.aborted) {
            await task.cancelUpstream();
            terminalStatus = "error";
            const abortError = new Error("Stream aborted");
            terminalError = abortError;
            await this.store.setStatus(sessionKey, "error", abortError.message);
            break;
          }
          const { done, value } = await reader.read();
          // cancel 会让 read 以 done=true 返回，必须先复查 abort，不能误判正常完成。
          if (task.abortController.signal.aborted) {
            terminalStatus = "error";
            const abortError = new Error("Stream aborted");
            terminalError = abortError;
            await this.store.setStatus(sessionKey, "error", abortError.message);
            break;
          }
          if (done) {
            terminalStatus = "completed";
            await this.store.setStatus(sessionKey, "completed");
            break;
          }
          if (value) {
            // 先持久化再广播：重放视图与 live 视图看到同一条提交边界。
            await this.store.appendChunk(sessionKey, value);
            for (const subscriber of [...task.subscribers]) {
              try {
                subscriber.controller.enqueue(value);
              } catch {
                task.subscribers.delete(subscriber);
              }
            }
          }
        }
      } catch (error) {
        terminalStatus = "error";
        terminalError = error;
        await this.store.setStatus(
          sessionKey,
          "error",
          error instanceof Error ? error.message : String(error)
        );
        this.sink.emit({
          type: "error",
          runId: task.runId,
          sessionId,
          code: "READER_ERROR",
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.clearTimers(task);
        this.closeSubscribers(task, terminalStatus, terminalError);
        this.scheduleCleanup(task);
      }
    })();

    return (await this.createResponse(sessionId, tenantId))!;
  }

  private async abortOwnedTask(task: OwnedStreamTask, reason: AbortReason): Promise<void> {
    if (task.abortController.signal.aborted) return;
    this.clearTimers(task);
    this.sink.emit({
      type: "abort",
      runId: task.runId,
      sessionId: task.sessionId,
      reason,
    });
    task.abortController.abort();
    void task.cancelUpstream?.().catch(() => {});
    // 保留既有客户端错误语义；具体 reason 由遥测事件承载。
    const error = new Error("Stream error");
    this.closeSubscribers(task, "error", error);
    this.tasks.delete(task.sessionKey);
    await this.store.setStatus(task.sessionKey, "error", reason);
    // 保持既有显式中止语义：abort 后立即移除，不占用 30 秒终态重放窗。
    await this.store.delete(task.sessionKey);
  }

  private clearTimers(task: OwnedStreamTask): void {
    if (task.deadlineTimer) {
      clearTimeout(task.deadlineTimer);
      task.deadlineTimer = undefined;
    }
    if (task.leaseTimer) {
      clearInterval(task.leaseTimer);
      task.leaseTimer = undefined;
    }
  }

  /** owner 运行时对象与共享记录均在终态保留 30 秒，供刷新页面做最后重放。 */
  private scheduleCleanup(task: OwnedStreamTask): void {
    const timer = setTimeout(() => {
      // 同会话可能已在保留窗内注册新任务；旧任务定时器不得删除新任务的共享记录。
      if (this.tasks.get(task.sessionKey) !== task) return;
      this.tasks.delete(task.sessionKey);
      void this.store.delete(task.sessionKey).catch(() => {});
    }, TERMINAL_RETENTION_MS);
    this.unrefTimer(timer);
  }

  private closeSubscribers(
    task: OwnedStreamTask,
    status: TaskStatus,
    error?: unknown
  ): void {
    for (const subscriber of task.subscribers) {
      try {
        if (status === "completed") {
          subscriber.controller.close();
        } else if (status === "error") {
          subscriber.controller.error(error ?? new Error("Stream error"));
        }
      } catch {
        // 客户端已断开时 controller 可能拒绝 close/error，清理其余订阅者即可。
      }
    }
    task.subscribers.clear();
  }

  private unrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
    const candidate = timer as { unref?: () => void };
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.unref === "function"
    ) {
      candidate.unref();
    }
  }
}

/** 全局缺省单例始终使用内存后端；env 文件后端由 createAnalyzeHandler 工厂显式构造。 */
export const defaultStreamHub = new SessionStreamHub();
