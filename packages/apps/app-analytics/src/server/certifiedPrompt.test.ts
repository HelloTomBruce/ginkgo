import { describe, it, expect } from "vitest";
import {
  certifiedQueriesSection,
  getOpenUISystemPrompt,
} from "./prompt";
import type { CertifiedQueryMatch } from "@openui-analytics/datasources";

describe("Certified Queries 提示词生成与注入", () => {
  const mockMatch: CertifiedQueryMatch = {
    query: {
      id: "cq_cac",
      sourceId: "pg_marketing",
      title: "获客成本 CAC 官方口径",
      description: "按渠道统计广告获客成本",
      businessMetricFormula: "CAC = SUM(spend) / COUNT(DISTINCT customer_id)",
      sqlTemplate: "SELECT channel, SUM(spend)/COUNT(DISTINCT customer_id) AS cac FROM ads GROUP BY channel",
      tags: ["cac", "获客"],
    },
    score: 0.88,
    confidence: "exact",
    matchedTerms: ["cac", "获客"],
  };

  it("certifiedQueriesSection 渲染认证指标、公式与 CTE 规范", () => {
    const text = certifiedQueriesSection([mockMatch]);
    expect(text).toContain("权威业务口径约束 (Certified Queries)");
    expect(text).toContain("获客成本 CAC 官方口径");
    expect(text).toContain("CAC = SUM(spend) / COUNT(DISTINCT customer_id)");
    expect(text).toContain("SELECT channel, SUM(spend)/COUNT(DISTINCT customer_id) AS cac");
    expect(text).toContain("严禁擅自修改核心度量与计算逻辑");
  });

  it("getOpenUISystemPrompt 在命中时将认证段注入前置提示词", () => {
    const prompt = getOpenUISystemPrompt([], undefined, undefined, [mockMatch]);
    expect(prompt).toContain("权威业务口径约束 (Certified Queries)");
    expect(prompt).toContain("cq_cac");
  });

  it("空匹配或低置信度时不注入认证段", () => {
    const lowMatch: CertifiedQueryMatch = {
      ...mockMatch,
      confidence: "low",
    };
    const text = certifiedQueriesSection([lowMatch]);
    expect(text).toBe("");

    const prompt = getOpenUISystemPrompt([], undefined, undefined, []);
    expect(prompt).not.toContain("权威业务口径约束");
  });

  it("high（0.6–0.85）置信度仅注入 Few-Shot 参考段，不含强约束措辞", () => {
    const highMatch: CertifiedQueryMatch = {
      ...mockMatch,
      confidence: "high",
      score: 0.7,
    };
    const text = certifiedQueriesSection([highMatch]);
    expect(text).toContain("相关认证口径参考");
    expect(text).toContain("Few-Shot");
    expect(text).toContain("cq_cac");
    // 弱命中不得出现「严禁」强约束
    expect(text).not.toContain("权威业务口径约束");
    expect(text).not.toContain("严禁擅自修改");
  });

  it("exact 与 high 混合命中时分段注入", () => {
    const highMatch: CertifiedQueryMatch = {
      ...mockMatch,
      confidence: "high",
      score: 0.7,
      query: { ...mockMatch.query, id: "cq_roi", title: "投放 ROI 参考口径" },
    };
    const text = certifiedQueriesSection([mockMatch, highMatch]);
    expect(text).toContain("权威业务口径约束");
    expect(text).toContain("严禁擅自修改");
    expect(text).toContain("相关认证口径参考");
    expect(text).toContain("cq_roi");
  });
});
