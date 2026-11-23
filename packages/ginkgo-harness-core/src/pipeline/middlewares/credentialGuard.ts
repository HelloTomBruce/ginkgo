import type { MiddlewareFunction } from "../pipeline";
import type { ResiliencePolicy } from "../../providers/resilience";

export interface CredentialGuardOptions {
  clientKey?: string;
  clientBaseURL?: string;
  resiliencePolicy?: ResiliencePolicy;
}

/**
 * 凭证防越权护栏中间件（CRED_GUARD）：
 * 1. 客户端自带 baseURL 时必须同时自带 apiKey，拒绝以环境凭证请求未授权的任意外部 URL
 * 2. Fallback 模型链中，若候选模型指向新 baseURL 也必须自带独立 apiKey
 */
export function createCredentialGuardMiddleware(
  options: CredentialGuardOptions
): MiddlewareFunction {
  return async (ctx, next) => {
    const { clientKey, clientBaseURL, resiliencePolicy } = options;

    // 1. 主请求护栏
    if (clientBaseURL && !clientKey) {
      ctx.telemetry.emit({
        type: "warn",
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        code: "CRED_GUARD_REJECTED",
        detail: "自定义 baseURL 时未提供 apiKey，拒绝以环境凭证请求任意 URL",
      });
      ctx.response = Response.json(
        { error: "自定义 baseURL 时必须同时提供 apiKey（不允许与服务端环境凭证混用）" },
        { status: 400 }
      );
      return;
    }

    // 2. Fallback 链护栏
    if (resiliencePolicy?.fallbacks && resiliencePolicy.fallbacks.length > 0) {
      const primaryBase = (ctx.modelSpec.baseURL ?? "https://api.openai.com/v1").replace(
        /\/+$/,
        ""
      );
      for (const fb of resiliencePolicy.fallbacks) {
        const effectiveBase = (fb.baseURL ?? ctx.modelSpec.baseURL ?? "").replace(
          /\/+$/,
          ""
        );
        if (effectiveBase && effectiveBase !== primaryBase && !fb.apiKey) {
          ctx.telemetry.emit({
            type: "warn",
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            code: "CRED_GUARD_REJECTED",
            detail: `fallback 模型 ${fb.model} 指向新 baseURL 但未提供 apiKey，拒绝以主请求凭证请求`,
          });
          ctx.response = Response.json(
            { error: "fallback 模型指向新 baseURL 时必须自带 apiKey（不允许与服务端环境凭证混用）" },
            { status: 400 }
          );
          return;
        }
      }
    }

    await next();
  };
}
