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

export interface StreamSubscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

export interface SessionStreamTask {
  sessionId: string;
  chunks: Uint8Array[];
  subscribers: Set<StreamSubscriber>;
  status: "running" | "completed" | "error";
  abortController: AbortController;
  error?: unknown;
  startedAt: number;
}

export class SessionStreamHub {
  private tasks = new Map<string, SessionStreamTask>();

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

  abortTask(sessionId: string): boolean {
    const task = this.tasks.get(sessionId);
    if (!task) return false;
    task.abortController.abort();
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
   * 并返回首个订阅者的 HTTP Response
   */
  registerAndConsume(
    sessionId: string,
    rawResponse: Response,
    onComplete?: () => Promise<void> | void
  ): Response {
    // 若原会话已有未完成旧任务，先中止
    if (this.hasRunningTask(sessionId)) {
      this.abortTask(sessionId);
    }

    const abortController = new AbortController();
    const task: SessionStreamTask = {
      sessionId,
      chunks: [],
      subscribers: new Set(),
      status: "running",
      abortController,
      startedAt: Date.now(),
    };
    this.tasks.set(sessionId, task);

    // 服务端独立异步 Reader：持续从 rawResponse.body 读取并广播
    void (async () => {
      const reader = rawResponse.body?.getReader();
      if (!reader) {
        console.error("[StreamHub] No reader on rawResponse.body, body is:", rawResponse.body);
        task.status = "error";
        return;
      }
      try {
        while (true) {
          if (task.abortController.signal.aborted) {
            await reader.cancel().catch(() => {});
            task.status = "error";
            break;
          }
          const { done, value } = await reader.read();
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
        console.error("[StreamHub] Reader error:", err);
        task.status = "error";
        task.error = err;
      } finally {
        this.closeSubscribers(task);
        try {
          await onComplete?.();
        } catch {
          // ignore
        }
        // 任务完成后在内存保留 30 秒，供刚刷新完成的页面做最后重放
        setTimeout(() => {
          if (this.tasks.get(sessionId) === task) {
            this.tasks.delete(sessionId);
          }
        }, 30000);
      }
    })();

    return this.createResponse(sessionId)!;
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
