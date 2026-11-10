import { dashboardStore, toSummary } from "@/lib/dashboardStore";
import { retargetTemplate } from "@/lib/templateRetarget";
import { datasources } from "@/lib/datasources";

/**
 * POST /api/dashboards/from-template — 用模板新建（换源重绑定，M3-4）。
 * body: { templateId, targetSourceId, prompt? }
 * 重绑定 → 新 id 落盘（kind 归位 favorite）→ 返回新记录。模板本体不动。
 * - 400 参数缺失/非法（含重绑定校验失败）
 * - 404 模板不存在 或 目标源不可用
 * - 201 `{ dashboard: 新记录摘要 }`
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      templateId?: string;
      targetSourceId?: string;
      prompt?: string;
    } | null;
    if (!body || typeof body.templateId !== "string" || !body.templateId) {
      return Response.json({ error: "缺少 templateId" }, { status: 400 });
    }
    if (typeof body.targetSourceId !== "string" || !body.targetSourceId) {
      return Response.json({ error: "缺少 targetSourceId" }, { status: 400 });
    }

    const template = await dashboardStore.get(body.templateId);
    if (!template) {
      return Response.json({ error: `模板不存在: ${body.templateId}` }, { status: 404 });
    }

    const targetSource = datasources.get(body.targetSourceId);
    if (!targetSource || targetSource.enabled === false) {
      return Response.json(
        { error: `目标数据源不可用: ${body.targetSourceId}（不存在或已停用）` },
        { status: 404 }
      );
    }

    const verdict = retargetTemplate(template, body.targetSourceId, targetSource, {
      ...(typeof body.prompt === "string" && body.prompt ? { prompt: body.prompt } : {}),
    });
    if (!verdict.ok) {
      const status =
        verdict.reason === "static-template" || verdict.reason === "invalid-source-id"
          ? 400
          : 404;
      return Response.json({ error: verdict.detail ?? verdict.reason }, { status });
    }

    // 标题注记来源模板；prompt 缺省用模板抽象提问
    const draft = {
      ...verdict.record,
      title: `${template.title}（模板副本）`,
      prompt: verdict.record.prompt ?? template.templateMeta?.abstractPrompt,
    };

    const created = await dashboardStore.upsert(draft);
    if (!created.ok) {
      return Response.json({ errors: created.errors }, { status: created.status });
    }
    return Response.json({ dashboard: toSummary(created.record) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
