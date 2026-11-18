import { POST as analyzePOST } from "../analyze/route";

/**
 * 用量出口（WS-11）：读 harness 的成本台账，供设置页用量面板供数。
 * 未启用台账（未注入 costLedger 且未配置配额）时返回 enabled: false。
 * 租户取自查询参数；缺省 anon（与 harness 未鉴权时的租户一致）。
 */
export async function GET(req: Request) {
  const ledger = analyzePOST.costLedger;
  if (!ledger) {
    return Response.json({ enabled: false });
  }
  const { searchParams } = new URL(req.url);
  const tenant = searchParams.get("tenant") ?? "anon";
  const windowMs = 24 * 60 * 60 * 1000;
  const usage = await ledger.sumUsage(tenant, windowMs);
  return Response.json({ enabled: true, tenant, windowMs, ...usage });
}
