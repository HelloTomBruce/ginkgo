import type { CoreMessage, CoreTool, LanguageModel } from "ai";
import type { TelemetrySink } from "../telemetry/telemetry";
import type { ResolvedModelSpec } from "../providers/resilience";

/**
 * Harness 统一执行上下文：贯穿整个中间件洋葱管道
 */
export interface HarnessContext<TState = Record<string, unknown>> {
  /** 任务唯一追踪 ID */
  readonly runId: string;
  /** 租户命名空间 */
  readonly tenantId: string;
  /** 会话标识（可选） */
  readonly sessionId?: string;
  /** 原生 HTTP 请求对象（可选） */
  readonly req?: Request;
  /** 结构化遥测 Sink */
  readonly telemetry: TelemetrySink;

  /** 解析后的模型规格 */
  modelSpec: ResolvedModelSpec;
  /** 当前装配的 LanguageModel 实例 */
  languageModel: LanguageModel;

  /** 系统提示词 */
  systemPrompt: string;
  /** 待发送给模型的消息投影队列 */
  messages: CoreMessage[];
  /** 注册的工具字典 */
  tools: Record<string, CoreTool>;

  /** 用户自定义跨中间件共享状态字典 */
  state: TState;
  /** 是否短路并已产生最终响应 */
  response?: Response;
}

export type MiddlewareNext = () => Promise<void>;

export type MiddlewareFunction<TState = Record<string, unknown>> = (
  ctx: HarnessContext<TState>,
  next: MiddlewareNext
) => Promise<void>;

export interface HarnessMiddleware<TState = Record<string, unknown>> {
  name?: string;
  execute: MiddlewareFunction<TState>;
}

/**
 * 洋葱模型中间件责任链管线（对标 Koa / Semantic Kernel Filters）
 */
export class HarnessPipeline<TState = Record<string, unknown>> {
  private readonly middlewares: MiddlewareFunction<TState>[] = [];

  /**
   * 注册中间件
   */
  use(
    middleware:
      | HarnessMiddleware<TState>
      | MiddlewareFunction<TState>
  ): this {
    if (typeof middleware === "function") {
      this.middlewares.push(middleware);
    } else if (typeof middleware?.execute === "function") {
      this.middlewares.push(middleware.execute.bind(middleware));
    }
    return this;
  }

  /**
   * 按序执行洋葱模型流水线
   */
  async run(ctx: HarnessContext<TState>): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("next() called multiple times in middleware");
      }
      index = i;
      const fn = this.middlewares[i];
      if (!fn) return;

      await fn(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  }
}
