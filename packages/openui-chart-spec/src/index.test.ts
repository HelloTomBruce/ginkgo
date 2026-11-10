import { describe, it, expect } from "vitest";
import {
  ChartSpecSchema,
  parseChartSpec,
  specToGroupByAndMetrics,
  CHART_TYPES,
  CHART_SPEC_LIMITS,
} from "./index";

/** 合法基线 spec：柱状图，一个维度一个指标 */
const validSpec = {
  title: "各省容量分布",
  dims: [{ field: "province" }],
  meas: [{ field: "capacity", agg: "sum" }],
  chartType: "bar",
  sourceId: "postgres-main",
};

describe("ChartSpecSchema 合法输入", () => {
  it("基线 spec 通过", () => {
    const r = ChartSpecSchema.safeParse(validSpec);
    expect(r.success).toBe(true);
  });

  it("全部 chartType 枚举可解析", () => {
    for (const chartType of CHART_TYPES) {
      const r = ChartSpecSchema.safeParse({ ...validSpec, chartType });
      // pie/donut 多指标被拦截，单指标即可
      if (chartType === "pie" || chartType === "donut") {
        expect(r.success).toBe(true);
      } else if (chartType === "scatter") {
        expect(r.success).toBe(false); // 散点要求 2 指标
      } else {
        expect(r.success).toBe(true);
      }
    }
  });

  it("完整字段（filters/sort/limit/style）通过", () => {
    const r = ChartSpecSchema.safeParse({
      ...validSpec,
      dims: [{ field: "month", granularity: "month", label: "月份" }],
      meas: [
        { field: "spend", agg: "sum", label: "花费", format: "currency" },
        { field: "leads", agg: "count", format: "compact" },
      ],
      filters: [
        { field: "channel", op: "eq", value: "TikTok Ads" },
        { field: "status", op: "in", value: ["open", "pending"] },
        { field: "amount", op: "between", value: [100, 5000] },
        { field: "title", op: "contains", value: "告警" },
      ],
      sort: { key: "spend", desc: true },
      limit: 50,
      style: {
        thresholds: [{ when: { field: "spend", op: "gt", value: 1000 }, color: "danger" }],
        referenceLines: [{ value: 500, label: "目标线", color: "success" }],
        showLegend: true,
        showLabel: false,
      },
    });
    expect(r.success).toBe(true);
  });

  it("3 维度 12 指标（上限值）通过", () => {
    const r = ChartSpecSchema.safeParse({
      ...validSpec,
      dims: [{ field: "a" }, { field: "b" }, { field: "c" }],
      meas: Array.from({ length: 12 }, (_, i) => ({ field: `m${i}`, agg: "sum" })),
    });
    expect(r.success).toBe(true);
  });
});

describe("ChartSpecSchema 非法输入", () => {
  it("字段名非法（非标识符/超长）拒绝", () => {
    expect(ChartSpecSchema.safeParse({ ...validSpec, dims: [{ field: "1abc" }] }).success).toBe(false);
    expect(
      ChartSpecSchema.safeParse({ ...validSpec, dims: [{ field: "a".repeat(65) }] }).success
    ).toBe(false);
  });

  it("维度/指标越界拒绝", () => {
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        dims: [{ field: "a" }, { field: "b" }, { field: "c" }, { field: "d" }],
      }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        meas: Array.from({ length: 13 }, (_, i) => ({ field: `m${i}`, agg: "sum" })),
      }).success
    ).toBe(false);
  });

  it("非法聚合方式/过滤算子/语义色拒绝（封闭词汇表）", () => {
    expect(
      ChartSpecSchema.safeParse({ ...validSpec, meas: [{ field: "m", agg: "median" }] }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        filters: [{ field: "f", op: "regex", value: "x" }],
      }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        style: { thresholds: [{ when: { field: "m", op: "gt", value: 1 }, color: "#ff0000" }] },
      }).success
    ).toBe(false);
  });

  it("pie/donut 多指标拒绝", () => {
    const two = {
      ...validSpec,
      meas: [{ field: "a", agg: "sum" }, { field: "b", agg: "sum" }],
    };
    expect(ChartSpecSchema.safeParse({ ...two, chartType: "pie" }).success).toBe(false);
    expect(ChartSpecSchema.safeParse({ ...two, chartType: "donut" }).success).toBe(false);
  });

  it("scatter 指标数 ≠ 2 拒绝", () => {
    expect(
      ChartSpecSchema.safeParse({ ...validSpec, chartType: "scatter" }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        chartType: "scatter",
        meas: [{ field: "x", agg: "sum" }, { field: "y", agg: "sum" }, { field: "z", agg: "sum" }],
      }).success
    ).toBe(false);
  });

  it("op 与 value 形态不配套拒绝", () => {
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        filters: [{ field: "f", op: "between", value: 100 }],
      }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        filters: [{ field: "f", op: "in", value: [] }],
      }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        filters: [{ field: "f", op: "in", value: "single" }],
      }).success
    ).toBe(false);
    expect(
      ChartSpecSchema.safeParse({
        ...validSpec,
        filters: [{ field: "f", op: "eq", value: ["a", "b"] }],
      }).success
    ).toBe(false);
  });

  it("limit 越过上限 / sourceId 不合规则拒绝", () => {
    expect(
      ChartSpecSchema.safeParse({ ...validSpec, limit: CHART_SPEC_LIMITS.limitMax + 1 }).success
    ).toBe(false);
    expect(ChartSpecSchema.safeParse({ ...validSpec, sourceId: "Bad_Source" }).success).toBe(false);
  });
});

describe("parseChartSpec", () => {
  it("合法返回解析值，非法返回 null（不抛错）", () => {
    expect(parseChartSpec(validSpec)?.chartType).toBe("bar");
    expect(parseChartSpec("not a spec")).toBeNull();
    expect(parseChartSpec(null)).toBeNull();
  });
});

describe("specToGroupByAndMetrics", () => {
  it("正确投影 dims→groupBy、meas→metrics（与 TransformSpec 对齐）", () => {
    const { groupBy, metrics } = specToGroupByAndMetrics({
      ...validSpec,
      dims: [{ field: "province" }, { field: "city" }],
      meas: [{ field: "capacity", agg: "sum" }, { field: "count", agg: "count" }],
    } as never);
    expect(groupBy).toEqual(["province", "city"]);
    expect(metrics).toEqual({ capacity: "sum", count: "count" });
  });
});
