import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CohortRetentionLayout } from "./CohortRetentionLayout";

afterEach(cleanup);

describe("CohortRetentionLayout 留存队列模板", () => {
  it("正常渲染页头、徽章及各个插槽内容", () => {
    render(
      <CohortRetentionLayout
        title="用户7日留存分析"
        subtitle="2026年Q3全渠道"
        controls={<div>筛选区</div>}
        kpis={<div>KPI 留存指标</div>}
        heatmapMatrix={<div>留存热力表格</div>}
        decayTrend={<div>衰减折线图</div>}
        verdict={<div>结论建议</div>}
      />
    );

    expect(screen.getByText("用户7日留存分析")).toBeInTheDocument();
    expect(screen.getByText("2026年Q3全渠道")).toBeInTheDocument();
    expect(screen.getByText("Cohort Retention")).toBeInTheDocument();
    expect(screen.getByText("筛选区")).toBeInTheDocument();
    expect(screen.getByText("KPI 留存指标")).toBeInTheDocument();
    expect(screen.getByText("留存热力表格")).toBeInTheDocument();
    expect(screen.getByText("衰减折线图")).toBeInTheDocument();
    expect(screen.getByText("结论建议")).toBeInTheDocument();
  });

  it("无内容时安全容错不崩溃", () => {
    const { container } = render(<CohortRetentionLayout />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
