import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MonitoringLayout } from "./MonitoringLayout";

afterEach(cleanup);

describe("MonitoringLayout 监控巡检模板", () => {
  it("渲染页头、状态指示、状态横幅与各区块", () => {
    render(
      <MonitoringLayout
        title="支付网关稳定性巡检"
        subtitle="近24小时异动排查"
        status="critical"
        statusBanner={<div>告警横幅：支付失败率达到 4.2%</div>}
        controls={<div>筛选区</div>}
        anomalies={<div>异动指标</div>}
        details={<div>异常明细</div>}
        actions={<div>应急措施</div>}
      />
    );

    expect(screen.getByText("支付网关稳定性巡检")).toBeInTheDocument();
    expect(screen.getByText("近24小时异动排查")).toBeInTheDocument();
    expect(screen.getByText("严重告警")).toBeInTheDocument();
    expect(screen.getByText("告警横幅：支付失败率达到 4.2%")).toBeInTheDocument();
    expect(screen.getByText("筛选区")).toBeInTheDocument();
    expect(screen.getByText("异动指标")).toBeInTheDocument();
    expect(screen.getByText("异常明细")).toBeInTheDocument();
    expect(screen.getByText("应急措施")).toBeInTheDocument();
  });

  it("不同 status 正确渲染对应状态标签", () => {
    const { rerender } = render(<MonitoringLayout title="巡检" status="normal" />);
    expect(screen.getByText("系统正常")).toBeInTheDocument();

    rerender(<MonitoringLayout title="巡检" status="warning" />);
    expect(screen.getByText("异常关注")).toBeInTheDocument();
  });

  it("无内容时安全容错", () => {
    const { container } = render(<MonitoringLayout />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
