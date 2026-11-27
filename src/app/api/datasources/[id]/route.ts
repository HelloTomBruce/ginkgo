import {
  describeDynamicSource,
  isDbType,
  type DynamicSourceConfig,
} from "@ginkgolab/datasources";
import { datasources } from "@/lib/datasources";

/**
 * PATCH /api/datasources/:id — 部分更新（db / file 源）。
 * 成功后关闭旧连接按新配置重建。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const existing = datasources.get(id);
    if (!existing) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }

    const merged: DynamicSourceConfig = {
      ...existing,
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(existing.kind === "db" &&
      typeof body.connectionString === "string"
        ? { connectionString: body.connectionString }
        : {}),
      ...(existing.kind === "db" && isDbType(body.dbType)
        ? { dbType: body.dbType }
        : {}),
    };

    const verdict = datasources.validate(merged);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: 400 });
    }
    datasources.upsert(verdict.config);
    await datasources.close(id).catch(() => {});
    return Response.json({ source: describeDynamicSource(verdict.config) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/datasources/:id — 删除任意源并关闭其缓存连接；不存在 404。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = datasources.get(id);
    if (!existing) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }
    datasources.delete(id);
    await datasources.close(id).catch(() => {});
    if (existing.kind === "file") {
      await datasources.removeFiles(id).catch(() => {});
    }
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
