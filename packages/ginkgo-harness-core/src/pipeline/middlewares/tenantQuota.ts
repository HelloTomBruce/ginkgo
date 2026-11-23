import type { MiddlewareFunction } from "../pipeline";
import type { CostLedger, QuotaPolicy } from "../../finops/costLedger";
import { DEFAULT_QUOTA_WINDOW_MS } from "../../finops/costLedger";

export interface TenantQuotaOptions {
  costLedger?: CostLedger;
  quota?: QuotaPolicy;
  isReconnect?: boolean;
}

/**
 * 租户配额准入中间件：
 * 限制租户在滑动时间窗口内的累计 Token 消耗；超限时 429 拦截新请求（重连不占名额）
 */
export function createTenantQuotaMiddleware(
  options: TenantQuotaOptions
): MiddlewareFunction {
  return async (ctx, next) => {
    const { costLedger, quota, isReconnect } = options;

    if (quota?.tenantTokenLimit && costLedger && !isReconnect) {
      const windowMs = quota.windowMs ?? DEFAULT_QUOTA_WINDOW_MS;
      const windowUsage = await costLedger.sumUsage(ctx.tenantId, windowMs);

      if (windowUsage.tokens >= quota.tenantTokenLimit) {
        ctx.telemetry.emit({
          type: "warn",
          runId: ctx.runId,
          sessionId: ctx.sessionId,
          code: "QUOTA_EXCEEDED",
          detail: `租户 ${ctx.tenantId} 滚动窗累计 ${windowUsage.tokens} tokens 已达上限 ${quota.tenantTokenLimit},拒绝新任务`,
        });
        ctx.response = Response.json(
          { error: "租户额度已用尽，请稍后重试" },
          { status: 429 }
        );
        return;
      }
    }

    await next();
  };
}
