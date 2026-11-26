import { dashboardStore, toSummary, DEFAULT_DASHBOARD_APP_ID } from "@ginkgo/app-analytics/server";
import { resolveRuntimeServer } from "@/lib/apps/runtimeServers";

/**
 * POST /api/dashboards/:id/refresh — 活产物数据刷新（平台产物协议，全程零 LLM 调用）。
 *
 * 刷新计算委托给产物归属应用声明的 refreshArtifact（analytics = 宿主刷新引擎：
 * 按 record.queries 重放取数（sql 走只读守卫；tool 走只读白名单）→ 回填 dsl），
 * 本路由负责持久化与 HTTP 语义映射。降级语义：
 * - 404 产物不存在
 * - 400 静态快照（无 queries，v0.1 旧记录）或应用未启用刷新
 * - 502 数据源不存在/停用/连接失败，或全部查询重放失败（附「重新分析」引导；
 *   后者不落盘——原 dsl/dataUpdatedAt 原样保留）
 * - 500 DSL 解析/序列化失败（不落盘）
 * - 200 `{ dashboard: 摘要, stale: string[] }`：stale 为保留旧数据的组件
 *   statementId 列表；仅当全部组件刷新成功（stale 为空）才更新 dataUpdatedAt
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await dashboardStore.get(id);
    if (!record) {
      return Response.json({ error: `看板不存在: ${id}` }, { status: 404 });
    }

    // 产物协议分发：按记录归属应用委托刷新计算（应用未声明则 400）
    const appId = record.appId ?? DEFAULT_DASHBOARD_APP_ID;
    const server = resolveRuntimeServer(appId);
    if (!server?.refreshArtifact) {
      return Response.json(
        { error: `应用 [${appId}] 未启用产物数据刷新` },
        { status: 400 }
      );
    }

    const verdict = await server.refreshArtifact({ artifactId: id });
    if (!verdict.ok) {
      if (verdict.reason === "not-found") {
        return Response.json({ error: verdict.error }, { status: 404 });
      }
      if (verdict.reason === "readonly" || verdict.reason === "unsupported") {
        return Response.json({ error: verdict.error ?? "产物不支持刷新" }, { status: 400 });
      }
      if (verdict.reason === "source-unavailable" || verdict.reason === "replay-failed") {
        return Response.json({ error: verdict.error }, { status: 502 });
      }
      return Response.json({ error: verdict.error }, { status: 500 });
    }

    const stale = verdict.stale ?? [];
    const updated = await dashboardStore.update(id, {
      dsl: verdict.payload,
      // 部分组件 stale 时保留旧 dataUpdatedAt（过期徽标按 stale 精确到组件）
      ...(stale.length === 0 ? { dataUpdatedAt: Date.now() } : {}),
    });
    if (!updated.ok) {
      return Response.json({ errors: updated.errors }, { status: updated.status });
    }
    return Response.json({
      dashboard: toSummary(updated.record),
      stale,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
