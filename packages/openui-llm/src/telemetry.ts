/**
 * 结构化遥测(LLM harness 内部件,不对外导出):
 * 把 handler/streamHub 中原先的散文式 console 日志替换为类型化事件流,
 * 供成本核算(WS-3)、违规记录(WS-5)与 eval 指标(WS-6)消费。
 *
 * 接缝设计:sink 经 AnalyzeHandlerOptions 注入,缺省 NDJSON console——
 * 保留现有日志的可 grep 性,同时每行可被日志采集器结构化摄取;
 * llm 包不依赖任何遥测 SDK,接入 OTel 时由 app 侧写适配器即可。
 */

export type RunId = string;

/** 中止原因:user=用户显式停止 / timeout=任务超时看门狗 / budget=token 预算熔断 / new_task=同会话新任务顶替 */
export type AbortReason = "user" | "timeout" | "budget" | "new_task";

export type HarnessEvent =
  | {
      type: "run_start";
      runId: RunId;
      sessionId?: string;
      mode: string;
      model: string;
      maxSteps: number;
    }
  | {
      type: "step_finish";
      runId: RunId;
      sessionId?: string;
      /** 第 N 个生成步(1 起) */
      step: number;
      finishReason: string;
      toolCalls: string[];
      promptTokens?: number;
      /** 距上一个 step_finish(或流起点)的间隔,近似单步耗时 */
      durationMs: number;
    }
  | {
      type: "tool_result";
      runId: RunId;
      sessionId?: string;
      tool: string;
      sourceId?: string;
      ok: boolean;
      /** 结果 JSON 序列化字节数(估算,序列化失败记 -1) */
      bytes: number;
      durationMs: number;
    }
  | {
      type: "task_finish";
      runId: RunId;
      sessionId?: string;
      termination: string;
      status: string;
      /** onFinish 汇总的 SDK 累计值(多步总和),成本核算口径 */
      totalPromptTokens?: number;
      totalCompletionTokens?: number;
      durationMs: number;
    }
  | {
      type: "context_projection";
      runId: RunId;
      sessionId?: string;
      estimated: number;
      triggerAt: number;
      pruned: number;
      summarized: boolean;
    }
  | {
      type: "reconnect";
      runId: RunId;
      sessionId: string;
      /** 重连时瞬时重放的既有分块数 */
      replayedChunks: number;
    }
  | { type: "abort"; runId?: RunId; sessionId: string; reason: AbortReason }
  | { type: "warn"; runId?: RunId; sessionId?: string; code: string; detail?: string }
  | { type: "error"; runId?: RunId; sessionId?: string; code: string; detail?: string };

export interface TelemetrySink {
  emit(event: HarnessEvent): void;
}

/** 默认 sink:单行 JSON。error 级走 stderr,其余走 stdout,保持可 grep。 */
export function createConsoleSink(): TelemetrySink {
  return {
    emit(event) {
      const line = JSON.stringify(event);
      if (event.type === "error") {
        console.error(line);
      } else {
        console.log(line);
      }
    },
  };
}

/** 组合 sink:同一事件广播到多个下游(如 console + OTel 适配器)。 */
export function compositeSink(...sinks: TelemetrySink[]): TelemetrySink {
  return {
    emit(event) {
      for (const s of sinks) {
        try {
          s.emit(event);
        } catch {
          // 单个下游故障不拖垮其余,也不影响主链路
        }
      }
    },
  };
}

/** 新建 run id(crypto 随机,Node ≥22 全局可用) */
export function newRunId(): RunId {
  return globalThis.crypto.randomUUID();
}

/** 估算结果的 JSON 字节量;序列化失败返回 -1(circular 等病态结果不阻塞主流程) */
export function jsonByteSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf-8");
  } catch {
    return -1;
  }
}
