import type { MiddlewareFunction } from "../pipeline";
import { AutoHealingGuardrail, type StructureValidator } from "../../guardrails/autoHealing";

export interface AutoHealingMiddlewareOptions<T = unknown> {
  validator: StructureValidator<T>;
  healer: (fixPrompt: string) => Promise<string>;
  maxRounds?: number;
}

/**
 * 结构化输出自愈中间件：
 * 在模型产出最终文本后（post-invoke 阶段）预检关键 DSL/JSON 格式；
 * 若检测到语法破损，自动发起单步微循环修复并更新上下文中已产出的文本，彻底保障下游渲染可用性。
 */
export function createAutoHealingMiddleware<T = unknown>(
  options: AutoHealingMiddlewareOptions<T>
): MiddlewareFunction {
  return async (ctx, next) => {
    // 1. 先让下游与模型执行完毕产出文本
    await next();

    // 2. 从上下文中获取模型生成的最终文本（通常存放在 ctx.state.finalText 中）
    const rawText = (ctx.state as Record<string, unknown>).finalText;
    if (typeof rawText !== "string" || !rawText) {
      return;
    }

    const guardrail = new AutoHealingGuardrail({
      maxRounds: options.maxRounds ?? 1,
      telemetry: ctx.telemetry,
      runId: ctx.runId,
      sessionId: ctx.sessionId,
    });

    const result = await guardrail.enforce(rawText, options.validator, options.healer);

    if (result.healed) {
      (ctx.state as Record<string, unknown>).finalText = result.text;
    }
  };
}
