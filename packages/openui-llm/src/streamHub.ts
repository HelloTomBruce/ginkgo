/**
 * 会话流中继中枢（SessionStreamHub）：
 * 实现服务端与客户端生命周期解耦的后台流式任务管理。
 *
 * 核心机制：
 * 1. 后台持续运行：LLM 与工具调用的流式执行由服务端独立 Reader 驱动，不受客户端单次 TCP 连接断开影响。
 * 2. 分块缓冲（Chunk Buffering）：当前轮次生成的所有数据分块（token / tool-call / UI 数据）全量缓存在任务中。
 * 3. 无缝重连（Re-attach）：客户端刷新页面或重连时，秒级重放已产生的所有历史分块，并实时续接后续增量分块。
 * 4. 显式中止（Abort）：支持前端主动暂停/中止后台在途任务。
 */

import type { AbortReason, RunId, TelemetrySink } from "./telemetry";
import { createConsoleSink } from "./telemetry";

export interface StreamSubscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

export interface SessionStreamTask {
  sessionId: string;
  /** 创建该任务的请求 id(遥测事件串联;watchdog 定时中止时也用) */
  runId?: RunId;
  chunks: Uint8Array[];
  subscribers: Set<StreamSubscriber>;
  status: "running" | "completed" | "error";
  abortController: AbortController;
  error?: unknown;
  /** 中止时立即取消上游 reader：解除 read() 阻塞，让 abort 即刻生效（而非等下一个 chunk） */
  cancelUpstream?: () => Promise<void>;
  /** 任务级看门狗定时器：终态（完成/错误/中止）即清除 */
  deadlineTimer?: ReturnType<typeof setTimeout>;
}

/** 任务级看门狗超时的钳制边界 */
const TASK_TIMEOUT_MIN_MS = 30_000;
const TASK_TIMEOUT_MAX_MS = 3_600_000;
const TASK_TIMEOUT_DEFAULT_MS = 600_000;

export interface SessionStreamHubOptions {
  sink?: TelemetrySink;
  /** 任务 wall-clock 上限；缺省读 env LLM_TASK_TIMEOUT_MS，再缺省 10 分钟 */
  taskTimeoutMs?: number;
}

export class SessionStreamHub {
  private tasks = new Map<string, SessionStreamTask>();
  private readonly taskTimeoutMs: number;
  private sink: TelemetrySink;

  constructor(opts: SessionStreamHubOptions = {}) {
    this.sink = opts.sink ?? createConsoleSink();
    const envMs = Number(process.env.LLM_TASK_TIMEOUT_MS);
    const envValid = Number.isFinite(envMs) && envMs > 0;
    this.taskTimeoutMs = Math.min(
      Math.max(
        opts.taskTimeoutMs ?? (envValid ? envMs : TASK_TIMEOUT_DEFAULT_MS),
        TASK_TIMEOUT_MIN_MS
      ),
      TASK_TIMEOUT_MAX_MS
    );
  }

  hasRunningTask(sessionId: string): boolean {
    const task = this.tasks.get(sessionId);
    return task?.status === "running";
  }

  hasTask(sessionId: string): boolean {
    return this.tasks.has(sessionId);
  }

  getTask(sessionId: string): SessionStreamTask | undefined {
    return this.tasks.get(sessionId);
  }

  /** 当前 running 状态的任务数(并发准入的计数来源) */
  runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) {
      if (t.status === "running") n++;
    }
    return n;
  }

  abortTask(sessionId: string, reason: AbortReason = "user"): boolean {
    const task = this.tasks.get(sessionId);
    if (!task) return false;
    this.clearDeadline(task);
    this.sink.emit({
      type: "abort",
      runId: task.runId,
      sessionId,
      reason,
    });
    task.abortController.abort();
    // reader 可能正阻塞在 read()（上游慢思考/hang 住），cancel 让 abort 即刻生效，
    // 否则要等下一个 chunk 恰好到来才检查 aborted，上游会继续消耗 token
    void task.cancelUpstream?.().catch(() => {});
    task.status = "error";
    this.closeSubscribers(task);
    this.tasks.delete(sessionId);
    return true;
  }

  /**
   * 为当前任务创建一个新的 HTTP 响应流（供初始调用或重连调用订阅）
   */
  createResponse(sessionId: string): Response | null {
    const task = this.tasks.get(sessionId);
    if (!task) return null;

    let sub: StreamSubscriber | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 1. 瞬时重放当前轮次所有已产生分块（恢复至断开前状态）
        for (const chunk of task.chunks) {
          controller.enqueue(chunk);
        }
        if (task.status === "completed") {
          controller.close();
          return;
        }
        if (task.status === "error") {
          controller.error(task.error ?? new Error("Stream terminated"));
          return;
        }
        // 2. 注册为实时订阅者，后续分块继续 live 推送
        sub = { controller };
        task.subscribers.add(sub);
      },
      cancel() {
        if (sub) {
          task.subscribers.delete(sub);
        }
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
   * 注册由 createDataStreamResponse 产生的原始流，启动服务端后台 Reader 持续消费，
   * 并返回首个订阅者的 HTTP Response。
   * meta.runId 用于遥测事件串联；meta.abortController 允许调用方（handler）把同一
   * signal 传入 streamText，使 abortTask 真正传导到 provider 取消生成（停止计费）。
   */
  registerAndConsume(
    sessionId: string,
    rawResponse: Response,
    meta?: { runId?: RunId; abortController?: AbortController }
  ): Response {
    // 若原会话已有未完成旧任务，先中止
    if (this.hasRunningTask(sessionId)) {
      this.abortTask(sessionId, "new_task");
    }

    const abortController = meta?.abortController ?? new AbortController();
    const task: SessionStreamTask = {
      sessionId,
      runId: meta?.runId,
      chunks: [],
      subscribers: new Set(),
      status: "running",
      abortController,
    };
    this.tasks.set(sessionId, task);

    // 任务级看门狗：wall-clock 超限即中止（防 provider 挂起永久占用 Reader）
    task.deadlineTimer = setTimeout(() => {
      this.abortTask(sessionId, "timeout");
    }, this.taskTimeoutMs);
    // 常驻服务无需 unref（终态即清除）；仅防 CLI/测试环境被定时器拖住退出
    const t = task.deadlineTimer as { unref?: () => void };
    if (typeof t === "object" && t !== null && typeof t.unref === "function") {
      t.unref();
    }

    // 服务端独立异步 Reader：持续从 rawResponse.body 读取并广播
    void (async () => {
      const reader = rawResponse.body?.getReader();
      if (!reader) {
        // 上游响应无 body：任务即刻转入 error 并走统一清理，
        // 绝不能 early-return 绕过清理（否则 task 永久滞留 map，重连恒拿 error 流）
        task.status = "error";
        task.error = new Error("Upstream response has no body");
        this.sink.emit({
          type: "error",
          runId: task.runId,
          sessionId,
          code: "STREAM_BODY_UNREADABLE",
          detail: "rawResponse.body is not readable; terminating task",
        });
        this.closeSubscribers(task);
        this.scheduleCleanup(sessionId, task);
        return;
      }
      task.cancelUpstream = async () => {
        await reader.cancel().catch(() => {});
      };
      try {
        while (true) {
          if (task.abortController.signal.aborted) {
            await task.cancelUpstream();
            task.status = "error";
            break;
          }
          const { done, value } = await reader.read();
          // read() 解除阻塞（含被 cancel）后先复查中止态：
          // cancel 会让 read 以 done=true 返回，不能误判为正常完成
          if (task.abortController.signal.aborted) {
            task.status = "error";
            break;
          }
          if (done) {
            task.status = "completed";
            break;
          }
          if (value) {
            task.chunks.push(value);
            for (const sub of [...task.subscribers]) {
              try {
                sub.controller.enqueue(value);
              } catch {
                task.subscribers.delete(sub);
              }
            }
          }
        }
      } catch (err) {
        task.status = "error";
        task.error = err;
        this.sink.emit({
          type: "error",
          runId: task.runId,
          sessionId,
          code: "READER_ERROR",
          detail: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.clearDeadline(task);
        this.closeSubscribers(task);
        this.scheduleCleanup(sessionId, task);
      }
    })();

    return this.createResponse(sessionId)!;
  }

  /** 任务到达终态（完成/错误/中止）时清除看门狗定时器 */
  private clearDeadline(task: SessionStreamTask): void {
    if (task.deadlineTimer) {
      clearTimeout(task.deadlineTimer);
      task.deadlineTimer = undefined;
    }
  }

  /** 任务终态后在内存保留 30 秒，供刚刷新完成的页面做最后重放，之后自动清理 */
  private scheduleCleanup(sessionId: string, task: SessionStreamTask): void {
    setTimeout(() => {
      if (this.tasks.get(sessionId) === task) {
        this.tasks.delete(sessionId);
      }
    }, 30000);
  }

  private closeSubscribers(task: SessionStreamTask) {
    for (const sub of task.subscribers) {
      try {
        if (task.status === "completed") {
          sub.controller.close();
        } else if (task.status === "error") {
          sub.controller.error(task.error ?? new Error("Stream error"));
        }
      } catch {
        // ignore
      }
    }
    task.subscribers.clear();
  }
}

export const defaultStreamHub = new SessionStreamHub();
