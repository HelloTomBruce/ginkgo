import { describe, it, expect } from "vitest";
import { tryRepairTruncatedJson, normalizeLooseSpec } from "./specTolerance";

describe("specTolerance", () => {
  describe("tryRepairTruncatedJson", () => {
    it("合法的 JSON 直接返回", () => {
      const input = '{"chartType":"bar","dims":[{"field":"a"}]}';
      expect(tryRepairTruncatedJson(input)).toBe(input);
    });

    it("自动补全截断的数组与对象尾部括号", () => {
      const input = '{"chartType":"bar","data":[{"province":"广东","capacity":10';
      const repaired = tryRepairTruncatedJson(input);
      expect(repaired).not.toBeNull();
      const parsed = JSON.parse(repaired!);
      expect(parsed.chartType).toBe("bar");
      expect(parsed.data[0].province).toBe("广东");
    });

    it("自动修复截断在字符串内部的情况", () => {
      const input = '{"chartType":"bar","dims":[{"field":"cate';
      const repaired = tryRepairTruncatedJson(input);
      expect(repaired).not.toBeNull();
      const parsed = JSON.parse(repaired!);
      expect(parsed.chartType).toBe("bar");
      expect(parsed.dims[0].field).toBe("cate");
    });

    it("自动移除末尾多余逗号并闭合", () => {
      const input = '{"chartType":"bar","dims":[{"field":"a"}],';
      const repaired = tryRepairTruncatedJson(input);
      expect(repaired).not.toBeNull();
      const parsed = JSON.parse(repaired!);
      expect(parsed.chartType).toBe("bar");
    });
  });

  describe("normalizeLooseSpec", () => {
    it("别名 chartType 归一化", () => {
      expect(normalizeLooseSpec({ chartType: "column" }).chartType).toBe("bar");
      expect(normalizeLooseSpec({ chartType: "line_chart" }).chartType).toBe("line");
      expect(normalizeLooseSpec({ chartType: "donutChart" }).chartType).toBe("donut");
    });

    it("dims 纯字符串数组归一化为对象数组", () => {
      const normalized = normalizeLooseSpec({
        dims: ["region", "category"],
      });
      expect(normalized.dims).toEqual([
        { field: "region" },
        { field: "category" },
      ]);
    });

    it("meas 缺失 agg 时自动兜底为 sum", () => {
      const normalized = normalizeLooseSpec({
        meas: [{ field: "amount" }, "cost"],
      });
      expect(normalized.meas).toEqual([
        { field: "amount", agg: "sum" },
        { field: "cost", agg: "sum" },
      ]);
    });

    it("rows 兼容映射至 data", () => {
      const rows = [{ a: 1 }];
      const normalized = normalizeLooseSpec({ rows });
      expect(normalized.data).toBe(rows);
    });
  });
});
