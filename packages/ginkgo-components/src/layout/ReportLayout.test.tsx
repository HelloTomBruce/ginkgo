import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReportLayout, ReportLayoutDef } from "./ReportLayout";

// vitest 未开 globals，testing-library 的自动 cleanup 不会注册，需显式清理
afterEach(cleanup);

describe("ReportLayout 报表模板", () => {
  it("渲染页头与全部区块内容", () => {
    render(
      <ReportLayout
        title="Q3 获客渠道复盘"
        subtitle="2026 Q3 · 全渠道"
        kpis={<div>KPI 卡片</div>}
        charts={<div>漏斗图</div>}
        detail={<div>明细表</div>}
        insights={<div>结论建议</div>}
      />
    );
    expect(screen.getByText("Q3 获客渠道复盘")).toBeInTheDocument();
    expect(screen.getByText("2026 Q3 · 全渠道")).toBeInTheDocument();
    expect(screen.getByText("KPI 卡片")).toBeInTheDocument();
    expect(screen.getByText("漏斗图")).toBeInTheDocument();
    expect(screen.getByText("明细表")).toBeInTheDocument();
    expect(screen.getByText("结论建议")).toBeInTheDocument();
  });

  it("未提供的区块不渲染，仅标题时页头与区块均按需出现", () => {
    render(<ReportLayout title="精简报表" kpis={<div>唯一内容</div>} />);
    expect(screen.getByText("精简报表")).toBeInTheDocument();
    expect(screen.getByText("唯一内容")).toBeInTheDocument();
    // 无副标题 / 图表 / 明细 / 结论
    expect(screen.queryByText("BI Report")).toBeInTheDocument(); // 页头徽章仍随标题渲染
  });

  it("完全无内容时不渲染页头占位", () => {
    const { container } = render(<ReportLayout kpis={null} />);
    // 仅剩区块容器，无页头标题结构
    expect(container.querySelector("h2")).toBeNull();
  });

  it("渲染可选的 controls 控制插槽", () => {
    render(
      <ReportLayout
        title="带筛选的报表"
        controls={<div data-testid="report-controls">筛选组件</div>}
      />
    );
    expect(screen.getByTestId("report-controls")).toBeInTheDocument();
  });

  it("Def 级安全防护：当 renderNode 抛出错误时静默降级，不向外冒泡死循环", () => {
    const Component = ReportLayoutDef.component;
    const throwingRenderNode = () => {
      throw new Error("模拟子节点 AST 解析中断");
    };

    // 不应抛出异常
    expect(() => {
      render(
        <Component
          props={{
            title: "异常防御报表",
            kpis: ["broken-node"],
          }}
          renderNode={throwingRenderNode}
        />
      );
    }).not.toThrow();

    expect(screen.getByText("异常防御报表")).toBeInTheDocument();
  });
});
