// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildSpecQuery,
  validateSpecFields,
  granularityExpr,
  SPEC_ROW_CAP,
  TABLE_RE,
  type BuiltQuery,
} from "./specMaterialize";
import { ChartSpecSchema, type ChartSpec } from "@openui-analytics/chart-spec";

const baseSpec = {
  dims: [{ field: "province" }],
  meas: [{ field: "capacity", agg: "sum" }],
  chartType: "bar",
} as const;

function spec(overrides: Record<string, unknown>): ChartSpec {
  const parsed = ChartSpecSchema.parse({ ...baseSpec, ...overrides });
  return parsed;
}

describe("buildSpecQuery 基础生成", () => {
  it("postgres：最小 spec → SELECT/GROUP BY/LIMIT", () => {
    const q = buildSpecQuery(spec({}), { table: "power_stats", dbType: "postgres" });
    expect(q.sql).toBe(
      "SELECT province AS province, SUM(capacity) AS capacity\nFROM power_stats\nGROUP BY province\nLIMIT 200"
    );
    expect(q.params).toEqual([]);
  });

  it("输出别名去重：同字段双指标与维度同名字段", () => {
    const q = buildSpecQuery(
      spec({
        dims: [{ field: "region" }, { field: "created_at", granularity: "month" }],
        meas: [
          { field: "capacity", agg: "sum" },
          { field: "capacity", agg: "max" },
        ],
      }),
      { table: "t", dbType: "postgres" }
    );
    expect(q.sql).toContain("region AS region");
    expect(q.sql).toContain("date_trunc('month', created_at) AS created_at_month");
    expect(q.sql).toContain("SUM(capacity) AS capacity");
    expect(q.sql).toContain("MAX(capacity) AS capacity_2");
  });

  it("表名两段（schema.table）合法", () => {
    const q = buildSpecQuery(spec({}), { table: "public.power_stats", dbType: "postgres" });
    expect(q.sql).toContain("FROM public.power_stats");
  });
});

describe("buildSpecQuery 过滤参数化", () => {
  it("全部算子 → 占位符 + params 保序（postgres ?）", () => {
    const q = buildSpecQuery(
      spec({
        filters: [
          { field: "status", op: "eq", value: "open" },
          { field: "level", op: "ne", value: 3 },
          { field: "score", op: "gt", value: 10 },
          { field: "score", op: "lte", value: 99.5 },
          { field: "channel", op: "in", value: ["a", "b"] },
          { field: "amount", op: "between", value: [1, 100] },
          { field: "title", op: "contains", value: "告_警%" },
        ],
      }),
      { table: "t", dbType: "postgres" }
    );
    expect(q.sql).toContain("status = ?");
    expect(q.sql).toContain("level <> ?");
    expect(q.sql).toContain("score > ?");
    expect(q.sql).toContain("score <= ?");
    expect(q.sql).toContain("channel IN (?, ?)");
    expect(q.sql).toContain("amount BETWEEN ? AND ?");
    expect(q.sql).toContain("title LIKE ? ESCAPE '\\'");
    expect(q.params).toEqual([
      "open",
      3,
      10,
      99.5,
      "a",
      "b",
      1,
      100,
      "%告\\_警\\%%",
    ]);
  });

  it("clickhouse：命名占位 {pN} 且无 ESCAPE 子句", () => {
    const q = buildSpecQuery(
      spec({ filters: [{ field: "a", op: "eq", value: "x" }] }),
      { table: "t", dbType: "clickhouse" }
    );
    expect(q.sql).toContain("a = {p0}");
    expect(q.params).toEqual(["x"]);
    expect(q.sql).not.toContain("ESCAPE");
  });

  it("注入值留在参数位，不进入 SQL 文本", () => {
    const q = buildSpecQuery(
      spec({
        filters: [
          { field: "name", op: "eq", value: "x'; DROP TABLE t; --" },
          { field: "note", op: "contains", value: "' OR 1=1 --" },
        ],
      }),
      { table: "t", dbType: "postgres" }
    );
    expect(q.sql).not.toContain("DROP");
    expect(q.sql).not.toContain("OR 1=1");
    expect(q.params).toContain("x'; DROP TABLE t; --");
    expect(q.params).toContain("%' OR 1=1 --%");
  });
});

describe("buildSpecQuery 排序与上限", () => {
  it("合法排序键（输出别名）生成 ORDER BY DESC", () => {
    const q = buildSpecQuery(
      spec({ sort: { key: "capacity", desc: true } }),
      { table: "t", dbType: "postgres" }
    );
    expect(q.sql).toContain("ORDER BY capacity DESC");
  });

  it("排序键非输出别名（源字段不存在于输出）报错", () => {
    expect(() =>
      buildSpecQuery(spec({ sort: { key: "id" } }), { table: "t", dbType: "postgres" })
    ).toThrow(/排序键/);
  });

  it("limit 与 SPEC_ROW_CAP 取 min", () => {
    const q1 = buildSpecQuery(spec({ limit: 50 }), { table: "t", dbType: "postgres" });
    expect(q1.sql).toContain("LIMIT 50");
    // schema 上限内但越过 SPEC_ROW_CAP → 物化层再封到 200
    const q2 = buildSpecQuery(spec({ limit: 500 }), { table: "t", dbType: "postgres" });
    expect(q2.sql).toContain(`LIMIT ${SPEC_ROW_CAP}`);
    const q3 = buildSpecQuery(spec({}), { table: "t", dbType: "postgres" });
    expect(q3.sql).toContain(`LIMIT ${SPEC_ROW_CAP}`);
  });

  it("非法表名/字段名（非标识符）拒绝", () => {
    expect(() => buildSpecQuery(spec({}), { table: "t; DROP", dbType: "postgres" })).toThrow(/表名/);
    // 标识符白名单是物化层防线（schema 层 FIELD_RE 之外的直测，绕过 parse）
    const rawSpec = { ...baseSpec, dims: [{ field: "1x" }] } as unknown as ChartSpec;
    expect(() => buildSpecQuery(rawSpec, { table: "t", dbType: "postgres" })).toThrow(/维度字段/);
    expect(TABLE_RE.test("evil-1")).toBe(false);
  });

  it("时间粒度按方言编译（sqlite strftime / mysql DATE_FORMAT）", () => {
    const s = spec({ dims: [{ field: "day", granularity: "month" }] });
    expect(buildSpecQuery(s, { table: "t", dbType: "sqlite" }).sql).toContain(
      "strftime('%Y-%m-01', day) AS day_month"
    );
    expect(buildSpecQuery(s, { table: "t", dbType: "mysql" }).sql).toContain(
      "DATE_FORMAT(day, '%Y-%m-01') AS day_month"
    );
    expect(granularityExpr("day", "quarter", "sqlite")).not.toBeNull();
  });

  it("返回 outputAliases 供回填投影", () => {
    const q: BuiltQuery = buildSpecQuery(
      spec({ dims: [{ field: "province" }], meas: [{ field: "capacity", agg: "sum" }] }),
      { table: "t", dbType: "postgres" }
    );
    expect(q.outputAliases.get("province")).toBe("province");
    expect(q.outputAliases.get("capacity")).toBe("capacity");
  });
});

describe("validateSpecFields", () => {
  const columns = [
    { column: "province", type: "text" },
    { column: "capacity", type: "numeric" },
    { column: "status", type: "text" },
  ];

  it("全部字段存在 → ok", () => {
    const check = validateSpecFields(
      spec({ filters: [{ field: "status", op: "eq", value: "x" }] }),
      columns
    );
    expect(check).toEqual({ ok: true });
  });

  it("幻觉字段 → missing 明确列出", () => {
    const check = validateSpecFields(
      spec({
        meas: [{ field: "capac1ty", agg: "sum" }],
        sort: { key: "ghost" },
      }),
      columns
    );
    expect(check).toEqual({ ok: false, missing: ["capac1ty", "ghost"] });
  });
});

// ===== MCP 退化通道（M3-1）=====

import {
  rowMatchesSpecFilter,
  rowPassesSpecFilters,
  specToTransformSpec,
} from "./specMaterialize";
import { isValidTransformSpec, applyTransform } from "@openui-apps/analytics/isomorphic";

describe("rowMatchesSpecFilter 行级谓词", () => {
  const row = { channel: "TikTok Ads", spend: 120, title: "某告警事件", score: "3.5" };

  it("eq/ne 数值字符串互认", () => {
    expect(rowMatchesSpecFilter(row, { field: "spend", op: "eq", value: 120 })).toBe(true);
    expect(rowMatchesSpecFilter(row, { field: "spend", op: "eq", value: "120" })).toBe(true);
    expect(rowMatchesSpecFilter(row, { field: "spend", op: "ne", value: 120 })).toBe(false);
    expect(rowMatchesSpecFilter(row, { field: "channel", op: "eq", value: "Google Ads" })).toBe(false);
  });

  it("in 数组成员匹配", () => {
    expect(rowMatchesSpecFilter(row, { field: "channel", op: "in", value: ["Google Ads", "TikTok Ads"] })).toBe(true);
    expect(rowMatchesSpecFilter(row, { field: "channel", op: "in", value: ["Google Ads"] })).toBe(false);
  });

  it("gt/gte/lt/lte/between 数值比较（字符串数字容错）", () => {
    expect(rowMatchesSpecFilter(row, { field: "score", op: "gt", value: 3 })).toBe(true);
    expect(rowMatchesSpecFilter(row, { field: "score", op: "lt", value: 3 })).toBe(false);
    expect(rowMatchesSpecFilter(row, { field: "spend", op: "between", value: [100, 200] })).toBe(true);
    expect(rowMatchesSpecFilter(row, { field: "spend", op: "between", value: [200, 300] })).toBe(false);
  });

  it("contains 子串", () => {
    expect(rowMatchesSpecFilter(row, { field: "title", op: "contains", value: "告警" })).toBe(true);
    expect(rowMatchesSpecFilter(row, { field: "title", op: "contains", value: "故障" })).toBe(false);
  });
});

describe("rowPassesSpecFilters 全量通过语义", () => {
  const filters = [
    { field: "channel", op: "eq", value: "TikTok Ads" },
    { field: "spend", op: "gte", value: 100 },
  ];
  it("全部命中放行，任一不中拒绝", () => {
    expect(rowPassesSpecFilters({ channel: "TikTok Ads", spend: 150 }, filters)).toBe(true);
    expect(rowPassesSpecFilters({ channel: "Google Ads", spend: 150 }, filters)).toBe(false);
    expect(rowPassesSpecFilters({ channel: "TikTok Ads", spend: 50 }, filters)).toBe(false);
  });
});

describe("specToTransformSpec 投影", () => {
  it("dims→groupBy / meas→metrics / sort 透传 / limit 封顶", () => {
    const ts = specToTransformSpec(
      spec({
        sort: { key: "capacity", desc: true },
        limit: 50,
      })
    );
    expect(isValidTransformSpec(ts)).toBe(true);
    expect(ts.groupBy).toEqual(["province"]);
    expect(ts.metrics).toEqual({ capacity: "sum" });
    expect(ts.sort).toEqual({ key: "capacity", desc: true });
    expect(ts.limit).toBe(50);
  });

  it("limit 缺省封顶 SPEC_ROW_CAP；越界取 min", () => {
    expect(specToTransformSpec(spec({})).limit).toBe(200);
    expect(specToTransformSpec(spec({ limit: 500 })).limit).toBe(200);
  });

  it("排序键非维度/指标字段报错", () => {
    expect(() => specToTransformSpec(spec({ sort: { key: "id" } }))).toThrow(/排序键/);
  });

  it("投影产物可直接 applyTransform 聚合原始行（端到端语义）", () => {
    const ts = specToTransformSpec(spec({}));
    const raw = [
      { province: "广东", capacity: 10 },
      { province: "广东", capacity: 5 },
      { province: "江苏", capacity: 8 },
    ];
    const filtered = raw.filter((r) => rowPassesSpecFilters(r, spec({ filters: [{ field: "province", op: "eq", value: "广东" }] }).filters));
    const out = applyTransform(filtered, ts);
    // 注意：groupBy 含 capacity 聚合后省份行与聚合列并存（与 SQL 输出一致）
    expect(out.some((r) => r.province === "江苏")).toBe(false);
  });
});
