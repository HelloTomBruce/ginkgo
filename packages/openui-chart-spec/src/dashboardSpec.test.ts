import { describe, it, expect } from "vitest";
import { parseDashboardSpec, safeParseDashboardSpec, type DashboardSpec } from "./dashboardSpec";

describe("DashboardSpec 2.0 规格测试", () => {
  const sampleSpec: DashboardSpec = {
    version: "2.0",
    metadata: {
      id: "dash_sales_overview",
      title: "销售全景复盘看板",
      description: "Q3 销售指标与渠道转化分析",
    },
    queries: {
      q_monthly_revenue: {
        sourceId: "pg_main",
        sql: "SELECT month, revenue FROM monthly_summary",
      },
    },
    layout: {
      columns: 12,
      gap: 4,
      rows: [
        {
          id: "r1",
          widgets: [{ id: "w_kpi", colSpan: 12 }],
        },
      ],
    },
    widgets: {
      w_kpi: {
        type: "MetricCard",
        title: "总营收",
        queryBinding: {
          queryId: "q_monthly_revenue",
          metricFields: ["revenue"],
        },
      },
    },
  };

  it("正常解析合规的 DashboardSpec 2.0", () => {
    const parsed = parseDashboardSpec(sampleSpec);
    expect(parsed.version).toBe("2.0");
    expect(parsed.metadata.title).toBe("销售全景复盘看板");
    expect(parsed.queries["q_monthly_revenue"].sourceId).toBe("pg_main");
    expect(parsed.widgets["w_kpi"].type).toBe("MetricCard");
  });

  it("非法输入报错校验", () => {
    const invalid = { ...sampleSpec, version: "1.0" };
    const res = safeParseDashboardSpec(invalid);
    expect(res.success).toBe(false);
  });
});
