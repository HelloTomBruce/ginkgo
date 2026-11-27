// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 模板路由集成（M3-4）：save-as-template / from-template 成败路径
 * + 重绑定产物可零 LLM 刷新。store 与 datasources 单例 mock。
 */

const mocks = vi.hoisted(() => ({
  storeGet: vi.fn(),
  storeUpdate: vi.fn(),
  storeUpsert: vi.fn(),
  sourceGet: vi.fn(),
  sourceConnect: vi.fn(),
}));

vi.mock("@ginkgolab/app-analytics/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@ginkgolab/app-analytics/server")>();
  return {
    ...mod,
    dashboardStore: {
      get: mocks.storeGet,
      update: mocks.storeUpdate,
      upsert: mocks.storeUpsert,
    },
  };
});

vi.mock("@/lib/datasources", () => ({
  datasources: {
    get: mocks.sourceGet,
    connect: mocks.sourceConnect,
  },
}));

import { POST as saveAsTemplate } from "./[id]/save-as-template/route";
import { POST as fromTemplate } from "./from-template/route";

const TEMPLATE_RECORD = {
  id: "dash_tmpl0001",
  title: "容量模板",
  kind: "template",
  templateMeta: { abstractPrompt: "各省容量分布报表" },
  dsl: 'root = Root([chart])\nchart = SpecChart("各省容量", {"dims":[{"field":"province"}],"meas":[{"field":"capacity","agg":"sum"}],"chartType":"bar","sourceId":"pg1"}, "power_stats", [{"province":"广东","capacity":1}])',
  queries: [
    { id: "q_00af5f39", sourceId: "pg1", kind: "sql", payload: "SELECT province, capacity FROM power_stats" },
  ],
  bindings: { chart: "q_00af5f39" },
  createdAt: 1,
  updatedAt: 2,
};

const DUCK_SOURCE = { id: "duck1", name: "DuckDB", kind: "file", enabled: true };

function postJson(
  handler: (req: Request, ctx: never) => Promise<Response>,
  url: string,
  body: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  return handler(new Request(url, { method: "POST", body: JSON.stringify(body) }), ctx as never);
}

beforeEach(() => {
  mocks.storeGet.mockReset();
  mocks.storeUpdate.mockReset();
  mocks.storeUpsert.mockReset();
  mocks.sourceGet.mockReset();
  mocks.sourceConnect.mockReset();
});

describe("POST /api/dashboards/:id/save-as-template", () => {
  const ctx = { params: Promise.resolve({ id: "dash_fav00001" }) };

  it("收藏转模板：update kind+meta，200 返回摘要", async () => {
    mocks.storeGet.mockResolvedValue({
      ...TEMPLATE_RECORD,
      id: "dash_fav00001",
      kind: undefined,
      templateMeta: undefined,
      prompt: "各省容量分布",
    });
    mocks.storeUpdate.mockResolvedValue({
      ok: true,
      record: { ...TEMPLATE_RECORD, id: "dash_fav00001" },
    });
    const res = await postJson(saveAsTemplate, "http://x", {}, ctx);
    expect(res.status).toBe(200);
    expect(mocks.storeUpdate).toHaveBeenCalledWith("dash_fav00001", {
      kind: "template",
      templateMeta: { abstractPrompt: "各省容量分布" },
    });
  });

  it("看板不存在 → 404", async () => {
    mocks.storeGet.mockResolvedValue(null);
    const res = await postJson(saveAsTemplate, "http://x", {}, ctx);
    expect(res.status).toBe(404);
  });

  it("update 校验失败 → 透传 status", async () => {
    mocks.storeGet.mockResolvedValue(TEMPLATE_RECORD);
    mocks.storeUpdate.mockResolvedValue({ ok: false, status: 400, errors: ["x"] });
    const res = await postJson(saveAsTemplate, "http://x", {}, ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/dashboards/from-template", () => {
  it("换源重绑定 → upsert 新记录，201", async () => {
    mocks.storeGet.mockResolvedValue(TEMPLATE_RECORD);
    mocks.sourceGet.mockReturnValue(DUCK_SOURCE);
    mocks.storeUpsert.mockImplementation(async (body: Record<string, unknown>) => ({
      ok: true,
      record: { ...(body as object), id: "dash_new000001" },
    }));
    const res = await postJson(fromTemplate, "http://x", {
      templateId: "dash_tmpl0001",
      targetSourceId: "duck1",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dashboard.id).toBe("dash_new000001");
    expect(body.dashboard.kind).toBe("favorite");
    expect(mocks.storeUpsert).toHaveBeenCalledTimes(1);
    const drafted = mocks.storeUpsert.mock.calls[0][0] as {
      queries: { sourceId: string }[];
      dsl: string;
      title: string;
    };
    expect(drafted.queries[0].sourceId).toBe("duck1");
    expect(drafted.dsl).toContain('sourceId: "duck1"');
    expect(drafted.title).toContain("模板副本");
  });

  it("缺参 → 400", async () => {
    const res1 = await postJson(fromTemplate, "http://x", { targetSourceId: "duck1" });
    expect(res1.status).toBe(400);
    const res2 = await postJson(fromTemplate, "http://x", { templateId: "t" });
    expect(res2.status).toBe(400);
  });

  it("模板不存在 → 404；目标源不可用 → 404", async () => {
    mocks.storeGet.mockResolvedValue(null);
    const res1 = await postJson(fromTemplate, "http://x", {
      templateId: "nope",
      targetSourceId: "duck1",
    });
    expect(res1.status).toBe(404);
    mocks.storeGet.mockResolvedValue(TEMPLATE_RECORD);
    mocks.sourceGet.mockReturnValue(undefined);
    const res2 = await postJson(fromTemplate, "http://x", {
      templateId: "dash_tmpl0001",
      targetSourceId: "duck1",
    });
    expect(res2.status).toBe(404);
  });

  it("重绑定产物可零 LLM 刷新（queries+SpecChart 双通道换源语义完整）", async () => {
    mocks.storeGet.mockResolvedValue(TEMPLATE_RECORD);
    mocks.sourceGet.mockReturnValue(DUCK_SOURCE);
    let capturedDraft: Record<string, unknown> | null = null;
    mocks.storeUpsert.mockImplementation(async (body: Record<string, unknown>) => {
      capturedDraft = body;
      return { ok: true, record: { ...body, id: "dash_new000001" } };
    });
    await postJson(fromTemplate, "http://x", {
      templateId: "dash_tmpl0001",
      targetSourceId: "duck1",
    });
    // 草稿的 bindings 保留、transforms 未引入、dsl 为字符串且换了源
    expect(capturedDraft).not.toBeNull();
    const d = capturedDraft as unknown as { bindings: Record<string, string>; dsl: string };
    expect(d.bindings).toEqual({ chart: "q_00af5f39" });
    expect(typeof d.dsl).toBe("string");
    expect(d.dsl).not.toContain('sourceId: "pg1"');
  });
});

describe("审查回归：真实 store 语义（不经 mock 的字段校验）", () => {
  it("取消模板（PUT kind=favorite）清空 templateMeta 且无残留", async () => {
    const { createDashboardStore } = await import("@ginkgolab/app-analytics/server");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "dash-"));
    try {
      const store = createDashboardStore({ dir });
      const created = await store.upsert({
        title: "收藏看板",
        dsl: 'root = Root([t])\nt = DataTable("d", [], [{"a":1}])',
        queries: [{ id: "q_x", sourceId: "pg1", kind: "sql", payload: "SELECT 1" }],
        bindings: { t: "q_x" },
      });
      expect(created.ok).toBe(true);

      // 转模板
      const asTemplate = await store.update(created.ok ? created.record.id : "", {
        kind: "template",
        templateMeta: { abstractPrompt: "抽象提问" },
      });
      expect(asTemplate.ok).toBe(true);
      expect(asTemplate.ok && asTemplate.record.kind).toBe("template");
      expect(asTemplate.ok && asTemplate.record.templateMeta?.abstractPrompt).toBe("抽象提问");

      // 取消模板：kind=favorite 即显式清空 meta
      const back = await store.update(created.ok ? created.record.id : "", {
        kind: "favorite",
      });
      expect(back.ok).toBe(true);
      expect(back.ok && back.record.kind).toBe("favorite");
      expect(back.ok && back.record.templateMeta).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
