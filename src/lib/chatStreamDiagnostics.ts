"use client";

/**
 * 会话流请求元数据与故障诊断（领域中立，ChatDashboard 消费）
 * 职责：请求全生命周期耗时记录、HTTP 错误拦截、流中断归因分析与排查指引。
 * 纯函数（耗时格式化 / toast 文案选择）与副作用函数（console 诊断 / 探活探测）分离，便于单测。
 */

/** 会话流请求元数据 */
export interface ChatRequestMetadata {
  startTime: number;
  url: string;
  method: string;
  sessionId?: string;
  appId: string;
  model: string;
  promptSnippet?: string;
}

/** 携带全链路排查元数据的会话流错误 */
export interface ChatStreamError extends Error {
  status?: number;
  statusText?: string;
  responseBody?: string;
  elapsedMs?: number;
  requestMeta?: ChatRequestMetadata;
}

/** 用户主动中止判定 */
export function isAbortError(err: Error): boolean {
  return err.name === "AbortError" || Boolean(err.message?.includes("aborted"));
}

/** 网络类错误判定（fetch 层失败，非服务端 HTTP 状态错误） */
function isNetworkError(err: Error): boolean {
  return (
    err.name === "TypeError" ||
    Boolean(err.message?.includes("network error")) ||
    Boolean(err.message?.includes("Failed to fetch"))
  );
}

/** 耗时人性化格式：超 1 分钟显示「x.xm (y.y s)」，否则「y.y s」，未知显示「未知」 */
export function formatElapsed(elapsedMs: number | undefined): string {
  if (elapsedMs === undefined) return "未知";
  return elapsedMs > 60000
    ? `${(elapsedMs / 60000).toFixed(1)}m (${(elapsedMs / 1000).toFixed(1)}s)`
    : `${(elapsedMs / 1000).toFixed(1)}s`;
}

/** 依据错误形态与耗时选择用户可读的 toast 文案（纯函数） */
export function buildStreamErrorMessage(err: Error, elapsedMs: number | undefined): string {
  const isGeneric =
    !err.message ||
    err.message === "An error occurred." ||
    err.message.includes("Failed to fetch") ||
    err.message.includes("network error");
  if (isGeneric) {
    return elapsedMs && elapsedMs > 60000
      ? `网络连接超时中断（已运行 ${formatElapsed(elapsedMs)}），已自动保存当前进度，您可以继续提问或点击重试`
      : "网络响应中断，已自动保存当前进度，您可以继续提问或点击重试";
  }
  return `响应异常：${err.message}`;
}

/** 提取错误对象上的流请求元数据（requestMeta 优先，回退最近一次请求记录） */
export function resolveStreamMeta(
  err: Error,
  lastMeta: ChatRequestMetadata | null
): { meta: ChatRequestMetadata | null; elapsedMs: number | undefined } {
  const streamErr = err as ChatStreamError;
  const meta = streamErr.requestMeta || lastMeta;
  const elapsedMs = streamErr.elapsedMs ?? (meta ? Date.now() - meta.startTime : undefined);
  return { meta, elapsedMs };
}

/** 诊断上下文（调用方传入的当前会话状态快照） */
export interface DiagnoseContext {
  fallbackSessionId?: string;
  fallbackAppId: string;
  fallbackModel: string;
}

/**
 * 结构化控制台诊断：错误详情分组 + 网络类错误的智能归因与本地服务存活探测。
 * 仅诊断不处置——落盘与 toast 由调用方负责；test 环境静默。
 */
export function diagnoseChatStreamError(
  err: Error,
  ctx: DiagnoseContext,
  meta: ChatRequestMetadata | null,
  elapsedMs: number | undefined
): void {
  if (process.env.NODE_ENV === "test") return;
  if (isAbortError(err)) return;

  const elapsedStr = formatElapsed(elapsedMs);
  const streamErr = err as ChatStreamError;

  console.group(
    `%c[ChatDashboard] 会话流异常: ${err.message || err.name} (耗时: ${elapsedStr})`,
    "color: #ef4444; font-weight: bold;"
  );
  console.error("【错误对象详情】", {
    name: err.name,
    message: err.message,
    status: streamErr.status,
    statusText: streamErr.statusText,
    cause: err.cause,
    stack: err.stack,
    responseBody: streamErr.responseBody,
  });
  console.info("【请求上下文信息】", {
    sessionId: meta?.sessionId || ctx.fallbackSessionId,
    appId: meta?.appId || ctx.fallbackAppId,
    model: meta?.model || ctx.fallbackModel,
    elapsed: elapsedStr,
    promptSnippet: meta?.promptSnippet,
    browserOnline: typeof navigator !== "undefined" ? navigator.onLine : "unknown",
  });

  if (isNetworkError(err)) {
    if (elapsedMs && elapsedMs > 120000) {
      console.warn(
        "💡 [排查提示] 请求在长达 " +
          elapsedStr +
          " 后发生 network error。通常原因为：\n" +
          "1. 大模型推理/工具链多步执行耗时较长，触发了浏览器、反向代理（如 Nginx）或 Node.js 的 Socket 默认空闲连接超时；\n" +
          "2. 本地 Node/Next.js 开发服务器在超长任务运行期间发生 GC 或连接重置；\n" +
          "建议：检查服务端后台控制台输出查看是否有 task_finish，或缩减单次复杂任务的步数。"
      );
    } else {
      console.warn(
        "💡 [排查提示] 短时间内发生 network error / Failed to fetch。通常原因为：\n" +
          "1. 本地 Next.js 服务可能已重启、中断或端口无法访问；\n" +
          "2. 本机网络或系统代理发生抖动（请确认 browserOnline 状态）。"
      );
    }

    // 本地服务存活探测（与诊断并发，不阻塞错误处置流程）
    if (typeof fetch !== "undefined") {
      const probeStart = Date.now();
      fetch("/api/datasources", { method: "GET" })
        .then((res) => {
          const probeDuration = Date.now() - probeStart;
          if (res.ok) {
            console.info(
              `%c[连通性探测] 本地服务连通正常 (HTTP ${res.status}, 延迟: ${probeDuration}ms)。说明 Next.js 后端依然健康，流断开属于长连接单点中断。`,
              "color: #10b981; font-weight: bold;"
            );
          } else {
            console.warn(
              `[连通性探测] 本地服务响应非 200 (HTTP ${res.status}, 延迟: ${probeDuration}ms)。`
            );
          }
        })
        .catch((probeErr: Error) => {
          console.error(
            `%c[连通性探测] 探测本地服务失败: ${probeErr.message}。本地后端服务可能已完全崩溃或无法连通。`,
            "color: #ef4444; font-weight: bold;"
          );
        });
    }
  }
  console.groupEnd();
}

/**
 * 增强型流请求 Fetch 工厂：记录请求元数据（最近一次经 onMeta 回调交由调用方持有），
 * 拦截非 2xx 响应并抛出携带全链路排查元数据的 ChatStreamError。
 */
export function createChatStreamFetch(options: {
  /** 返回发起时刻的请求上下文 */
  getContext: () => { sessionId?: string; appId: string; model: string };
  /** 元数据回调（调用方持久化最近一次请求元数据，供无 requestMeta 的错误回退查询） */
  onMeta: (meta: ChatRequestMetadata) => void;
}): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const startTime = Date.now();
    let promptSnippet = "";
    try {
      if (init?.body && typeof init.body === "string") {
        const parsed = JSON.parse(init.body) as {
          messages?: Array<{ content?: unknown }>;
        };
        const lastMsg = parsed.messages?.slice(-1)[0];
        if (lastMsg && typeof lastMsg.content === "string") {
          promptSnippet = lastMsg.content.slice(0, 80);
        }
      }
    } catch {
      // 容错忽略请求体解析异常
    }

    const meta: ChatRequestMetadata = {
      startTime,
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method || "POST",
      sessionId: options.getContext().sessionId,
      appId: options.getContext().appId,
      model: options.getContext().model,
      promptSnippet,
    };
    options.onMeta(meta);

    try {
      const response = await fetch(input, init);
      if (!response.ok) {
        let errorDetails = "";
        try {
          const clone = response.clone();
          errorDetails = await clone.text();
        } catch {
          // ignore
        }
        const error = new Error(
          `[HTTP ${response.status} ${response.statusText}] ${errorDetails.slice(0, 300) || "请求失败"}`
        ) as ChatStreamError;
        error.status = response.status;
        error.statusText = response.statusText;
        error.responseBody = errorDetails;
        error.elapsedMs = Date.now() - startTime;
        error.requestMeta = meta;
        throw error;
      }
      return response;
    } catch (err: unknown) {
      const elapsedMs = Date.now() - startTime;
      if (err instanceof Error) {
        const streamErr = err as ChatStreamError;
        streamErr.elapsedMs = elapsedMs;
        streamErr.requestMeta = meta;
      }
      throw err;
    }
  };
}
