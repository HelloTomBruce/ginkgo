import { describe, it, expect } from "vitest";
import { tokenizeText, matchCertifiedQueries } from "./semanticRouter";
import { CertifiedQueryStore } from "./certifiedStore";

describe("SemanticRouter 语义路由与口径召回", () => {
  const store = new CertifiedQueryStore({
    initialQueries: [
      {
        id: "cq_cac",
        sourceId: "pg_main",
        title: "渠道获客成本 CAC 分析",
        description: "各推广渠道花费与新增用户比值",
        businessMetricFormula: "CAC = SUM(spend) / COUNT(customer_id)",
        sqlTemplate: "WITH ...",
        tags: ["cac", "获客", "渠道", "投放"],
      },
      {
        id: "cq_revenue",
        sourceId: "pg_main",
        title: "月度净营收 Net Revenue",
        description: "结算口径总收入剔除退款与抵扣",
        businessMetricFormula: "净营收 = 支付总额 - 退款总额 - 优惠",
        sqlTemplate: "WITH ...",
        tags: ["营收", "收入", "财务", "退款"],
      },
    ],
  });

  it("tokenizeText 支持英文与中文词元提取", () => {
    const tokens = tokenizeText("分析一下 各渠道 CAC 成本");
    expect(tokens).toContain("cac");
    expect(tokens).toContain("渠道");
    expect(tokens).toContain("成本");
  });

  it("命中标签与标题时给予高评分与高置信度召回", () => {
    const matches = matchCertifiedQueries("我想看看不同渠道的 CAC 获客成本走势", ["pg_main"], store);

    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.query.id).toBe("cq_cac");
    expect(top.score).toBeGreaterThanOrEqual(0.65);
    expect(["exact", "high"]).toContain(top.confidence);
    expect(top.matchedTerms).toContain("cac");
  });

  it("命中财务指标时准确路由到净营收", () => {
    const matches = matchCertifiedQueries("财务上个月净营收剔除退款后是多少", ["pg_main"], store);

    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.query.id).toBe("cq_revenue");
    expect(top.matchedTerms).toContain("营收");
  });

  it("数据源未激活时自动过滤候选集", () => {
    const matches = matchCertifiedQueries("查看 CAC", ["other_source"], store);
    expect(matches).toHaveLength(0);
  });
});
