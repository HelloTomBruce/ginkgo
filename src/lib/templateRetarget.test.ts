// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  validateDashboardFields,
  TEMPLATE_ABSTRACT_PROMPT_MAX,
  TEMPLATE_SLOTS_MAX,
  type DashboardRecord,
} from "./dashboardStore";
import {
  retargetTemplate,
  type RetargetSourceInfo,
} from "./templateRetarget";

/**
 * 模板数据层测试（M3-3）：kind/templateMeta 校验、重绑定纯函数
 * （queries+DSL SpecChart 换源、目标源校验、形态拒绝）。
 */

const SPEC_DSL = [
  "root = Root([chart])",
  'chart = SpecChart("各省容量", {"dims":[{"field":"province"}],"meas":[{"field":"capacity","agg":"sum"}],"chartType":"bar","sourceId":"pg1"}, "power_stats", [{"province":"广东","capacity":1}])',
].join("\n");

function seedTemplate(overrides: Partial<DashboardRecord> = {}): DashboardRecord {
  return {
    id: "dash_tmpl0001",
    title: "容量模板",
    kind: "template",
    templateMeta: {
      abstractPrompt: "各省容量分布报表",
      slots: [{ bindingKey: "chart", role: "source", required: true }],
    },
    dsl: SPEC_DSL,
    queries: [
      { id: "q_00af5f39", sourceId: "pg1", kind: "sql", payload: "SELECT province, capacity FROM power_stats" },
    ],
    bindings: { chart: "q_00af5f39" },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const OK_SOURCE: RetargetSourceInfo = { id: "duck1", name: "DuckDB 文件源", enabled: true };

describe("validateDashboardFields kind/templateMeta", () => {
  it("合法 template 写入通过并规范化", () => {
    const v = validateDashboardFields({
      kind: "template",
      templateMeta: {
        abstractPrompt: " 各省容量分布 ",
        slots: [{ bindingKey: "chart", role: "source", required: true }],
      },
    });
    expect(v).toMatchObject({
      ok: true,
      value: {
        kind: "template",
        templateMeta: {
          abstractPrompt: "各省容量分布",
          slots: [{ bindingKey: "chart", role: "source", required: true }],
        },
      },
    });
  });

  it("非法 kind / 缺 abstractPrompt / 非法 role → 400", () => {
    expect(
      validateDashboardFields({ kind: "widget" }).ok
    ).toBe(false);
    const v2 = validateDashboardFields({
      kind: "template",
      templateMeta: { abstractPrompt: "" },
    });
    expect(v2.ok).toBe(false);
    const v3 = validateDashboardFields({
      kind: "template",
      templateMeta: { abstractPrompt: "x", slots: [{ bindingKey: "c", role: "widget" }] },
    });
    expect(v3.ok).toBe(false);
  });

  it("kind=template 但缺 templateMeta → 400", () => {
    const v = validateDashboardFields({ kind: "template" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join()).toContain("templateMeta");
  });

  it("slots 超上限 → 400", () => {
    const slots = Array.from({ length: TEMPLATE_SLOTS_MAX + 1 }, (_, i) => ({
      bindingKey: `k${i}`,
      role: "source" as const,
    }));
    const v = validateDashboardFields({
      kind: "template",
      templateMeta: { abstractPrompt: "x", slots },
    });
    expect(v.ok).toBe(false);
  });

  it("abstractPrompt 超长 → 400", () => {
    const v = validateDashboardFields({
      kind: "template",
      templateMeta: { abstractPrompt: "x".repeat(TEMPLATE_ABSTRACT_PROMPT_MAX + 1) },
    });
    expect(v.ok).toBe(false);
  });

  it("不传 kind → favorite 语义（旧记录兼容）", () => {
    const v = validateDashboardFields({ dsl: "root = Root([])" });
    expect(v.ok && v.value.kind).toBeUndefined();
  });
});

describe("retargetTemplate", () => {
  it("queries + DSL SpecChart 全部换源；kind 归位 favorite、meta 清空", () => {
    const v = retargetTemplate(seedTemplate(), "duck1", OK_SOURCE, { prompt: "用模板看 DuckDB" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      const r = v.record;
      expect(r.queries?.[0].sourceId).toBe("duck1");
      expect(r.dsl).toContain('sourceId: "duck1"');
      expect(r.dsl).not.toContain('sourceId: "pg1"');
      expect(r.bindings).toEqual({ chart: "q_00af5f39" });
      expect(r.kind).toBe("favorite");
      expect(r.templateMeta).toBeUndefined();
      expect(r.prompt).toBe("用模板看 DuckDB");
      expect(r.sourceNames).toEqual(["DuckDB 文件源"]);
    }
  });

  it("目标源不存在/停用 → source-unavailable", () => {
    expect(retargetTemplate(seedTemplate(), "nope", undefined).ok).toBe(false);
    expect(
      retargetTemplate(seedTemplate(), "off1", { id: "off1", enabled: false }).ok
    ).toBe(false);
  });

  it("目标源 id 形态非法 → invalid-source-id", () => {
    expect(retargetTemplate(seedTemplate(), "Bad Source", OK_SOURCE).ok).toBe(false);
  });

  it("非 template 记录 → static-template 拒绝", () => {
    const fav = seedTemplate({ kind: "favorite", templateMeta: undefined });
    const v = retargetTemplate(fav, "duck1", OK_SOURCE);
    expect(v).toMatchObject({ ok: false, reason: "static-template" });
  });

  it("无取数声明（静态模板）→ static-template 拒绝", () => {
    const staticTpl = seedTemplate({
      queries: undefined,
      bindings: undefined,
      dsl: 'root = Root([t])\nt = DataTable("明细", [], [{"a":1}])',
    });
    const v = retargetTemplate(staticTpl, "duck1", OK_SOURCE);
    expect(v).toMatchObject({ ok: false, reason: "static-template" });
  });

  it("DSL 解析失败且无 queries → dsl-invalid（如实上报，不再谎报 static-template）", () => {
    const broken = seedTemplate({
      queries: undefined,
      bindings: undefined,
      dsl: "这不是合法 DSL", // 与 dashboardRefresh dsl-invalid 用例同款必败输入
    });
    const v = retargetTemplate(broken, "duck1", OK_SOURCE);
    expect(v).toMatchObject({ ok: false, reason: "dsl-invalid" });
  });

  it("DSL 解析失败但 queries 存在 → queries 通道兜底仍可换源", () => {
    const broken = seedTemplate({ dsl: "这不是合法 DSL" });
    const v = retargetTemplate(broken, "duck1", OK_SOURCE);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.record.queries?.[0].sourceId).toBe("duck1");
  });
});

describe("M3-4 审查回归：origin 剥离与取消模板", () => {
  it("源自收藏的模板（带 origin）重绑定后 origin 被剥离——副本 upsert 不会覆盖原看板", () => {
    const withOrigin = seedTemplate({
      origin: { messageId: "msg-original", sessionId: "sess-1" },
    });
    const v = retargetTemplate(withOrigin, "duck1", OK_SOURCE);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.record.origin).toBeUndefined();
  });
});
