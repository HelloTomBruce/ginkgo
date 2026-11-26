import { dashboardStore, toSummary } from "@ginkgo/app-analytics/server";

/**
 * POST /api/dashboards/:id/save-as-template — 收藏看板转模板（M3-4）。
 * body: { abstractPrompt?: string }（缺省用原 prompt 或标题）。
 * - 404 看板不存在
 * - 400 模板参数非法（经 validateDashboardFields 复核）
 * - 200 `{ dashboard: 摘要 }`（kind=template，DSL/queries/bindings 不动）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await dashboardStore.get(id);
    if (!record) {
      return Response.json({ error: `看板不存在: ${id}` }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      abstractPrompt?: string;
    };
    const abstractPrompt =
      typeof body.abstractPrompt === "string" && body.abstractPrompt.trim().length > 0
        ? body.abstractPrompt.trim()
        : (record.prompt ?? record.title);

    const verdict = await dashboardStore.update(id, {
      kind: "template",
      templateMeta: { abstractPrompt },
    });
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: verdict.status });
    }
    return Response.json({ dashboard: toSummary(verdict.record) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
