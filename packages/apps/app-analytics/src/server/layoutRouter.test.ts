// @vitest-environment node
import { describe, it, expect } from "vitest";
import { selectLayoutExamples } from "./layoutRouter";
import {
  promptExample,
  reportLayoutExample,
  focusLayoutExample,
  comparisonLayoutExample,
} from "./prompt";

describe("selectLayoutExamples 布局范例动态选择", () => {
  it("复盘/报告类问法 → ReportLayout 范例", () => {
    const picked = selectLayoutExamples("帮我做一份 Q3 获客渠道复盘报告");
    expect(picked).toEqual([promptExample, reportLayoutExample]);
  });

  it("归因/为什么类问法 → FocusLayout 范例", () => {
    const picked = selectLayoutExamples("为什么这个月的 CAC 上升了？帮我做根因分析");
    expect(picked).toEqual([promptExample, focusLayoutExample]);
  });

  it("对比/差异类问法 → ComparisonLayout 范例", () => {
    const picked = selectLayoutExamples("对比一下 TikTok Ads 和 Google Ads 哪个更划算");
    expect(picked).toEqual([promptExample, comparisonLayoutExample]);
  });

  it("英文问法同样命中（why / vs / review）", () => {
    expect(selectLayoutExamples("why did churn spike last week")).toEqual([
      promptExample,
      focusLayoutExample,
    ]);
    expect(selectLayoutExamples("compare channel A vs channel B")).toEqual([
      promptExample,
      comparisonLayoutExample,
    ]);
    expect(selectLayoutExamples("monthly sales performance review")).toEqual([
      promptExample,
      reportLayoutExample,
    ]);
  });

  it("零命中回落 ReportLayout 兜底（覆盖「生成看板」类通用问法）", () => {
    expect(selectLayoutExamples("生成一个销售数据看板")).toEqual([
      promptExample,
      reportLayoutExample,
    ]);
  });

  it("空输入/undefined 等同零命中", () => {
    expect(selectLayoutExamples("")).toEqual([promptExample, reportLayoutExample]);
    expect(selectLayoutExamples("   ")).toEqual([promptExample, reportLayoutExample]);
    expect(selectLayoutExamples(undefined)).toEqual([promptExample, reportLayoutExample]);
  });

  it("多组命中取得分最高者（关键词数多的布局胜出）", () => {
    // 「复盘」+「报告」双命中 report(2) vs 对比(1) → report
    const picked = selectLayoutExamples("对比渠道的同时给一份季度复盘报告");
    expect(picked[1]).toBe(reportLayoutExample);
  });

  it("返回值恒为导出常量子集（受 promptExamples.test.ts schema 校验守护的合法 DSL）", () => {
    const valid = new Set([
      promptExample,
      reportLayoutExample,
      focusLayoutExample,
      comparisonLayoutExample,
    ]);
    for (const q of ["复盘", "为什么", "对比", "", undefined, "随便看看"]) {
      for (const example of selectLayoutExamples(q)) {
        expect(valid.has(example)).toBe(true);
      }
    }
  });
});
