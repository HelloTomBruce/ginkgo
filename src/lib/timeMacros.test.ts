import { describe, it, expect } from "vitest";
import {
  evaluateTimeMacros,
  inferTimeMacro,
  inferTimeMacrosInObject,
  formatDate,
} from "./timeMacros";

describe("timeMacros 时间宏引擎", () => {
  const fixedNow = new Date("2026-11-11T12:00:00.000Z");

  describe("evaluateTimeMacros 宏解析求值", () => {
    it("正确解析 {{$today}} 和相对天数 {{$today - 7d}}", () => {
      expect(evaluateTimeMacros("{{$today}}", fixedNow)).toBe(formatDate(fixedNow));
      const expected7d = formatDate(new Date("2026-11-04T12:00:00.000Z"));
      expect(evaluateTimeMacros("{{$today - 7d}}", fixedNow)).toBe(expected7d);
    });

    it("正确解析周期边界宏 {{$start_of_month}} 和 {{$start_of_year}}", () => {
      const startOfMonth = evaluateTimeMacros("{{$start_of_month}}", fixedNow);
      expect(startOfMonth).toMatch(/^\d{4}-11-01$/);

      const startOfYear = evaluateTimeMacros("{{$start_of_year}}", fixedNow);
      expect(startOfYear).toMatch(/^\d{4}-01-01$/);
    });

    it("支持字符串内嵌宏替换", () => {
      const sql = "SELECT * FROM orders WHERE created_at >= '{{$today - 30d}}'";
      const res = evaluateTimeMacros(sql, fixedNow);
      expect(res).toContain("WHERE created_at >= '");
      expect(res).not.toContain("{{$today");
    });

    it("递归支持对象与数组中的宏替换", () => {
      const args = {
        since: "{{$today - 7d}}",
        until: "{{$today}}",
        nested: {
          filters: ["status = 'open'", "date >= '{{$start_of_month}}'"],
        },
      };
      const res = evaluateTimeMacros(args, fixedNow);
      expect(res.until).toBe(formatDate(fixedNow));
      expect(res.nested.filters[1]).toContain("-11-01");
    });

    it("无宏字符串原样返回", () => {
      expect(evaluateTimeMacros("plain text", fixedNow)).toBe("plain text");
      expect(evaluateTimeMacros(12345, fixedNow)).toBe(12345);
    });
  });

  describe("inferTimeMacro 捕获期推测", () => {
    it("自动识别当天日期为 {{$today}}", () => {
      const todayStr = formatDate(fixedNow);
      expect(inferTimeMacro(todayStr, fixedNow)).toBe("{{$today}}");
    });

    it("自动识别一周前日期为 {{$today - 1w}}", () => {
      const weekAgo = new Date(fixedNow.getTime());
      weekAgo.setDate(weekAgo.getDate() - 7);
      expect(inferTimeMacro(formatDate(weekAgo), fixedNow)).toBe("{{$today - 1w}}");
    });

    it("自动识别月初日期为 {{$start_of_month}}", () => {
      const startOfMonth = new Date(fixedNow.getFullYear(), fixedNow.getMonth(), 1);
      expect(inferTimeMacro(formatDate(startOfMonth), fixedNow)).toBe("{{$start_of_month}}");
    });

    it("不可推测的历史固定日期返回 null", () => {
      expect(inferTimeMacro("2020-01-01", fixedNow)).toBeNull();
      expect(inferTimeMacro("not-a-date", fixedNow)).toBeNull();
    });

    it("inferTimeMacrosInObject 自动转换对象中的相对日期", () => {
      const weekAgo = new Date(fixedNow.getTime());
      weekAgo.setDate(weekAgo.getDate() - 7);
      const args = {
        since: formatDate(weekAgo),
        status: "active",
      };
      const res = inferTimeMacrosInObject(args, fixedNow);
      expect(res.since).toBe("{{$today - 1w}}");
      expect(res.status).toBe("active");
    });
  });
});
