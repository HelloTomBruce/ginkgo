import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ContextUsageIndicator } from "./ContextUsageIndicator";

afterEach(() => {
  cleanup();
});

describe("ContextUsageIndicator 环形上下文指示器", () => {
  it("正常渲染环形进度与百分比", () => {
    render(<ContextUsageIndicator promptTokens={32_000} window={128_000} />);
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("上下文")).toBeInTheDocument();
    expect(screen.getByText(/32\.0k \/ 128k（25%）/)).toBeInTheDocument();
  });

  it("不同阈值下的颜色状态", () => {
    const { container: c1 } = render(
      <ContextUsageIndicator promptTokens={30_000} window={100_000} />
    );
    expect(c1.querySelector(".text-success-solid")).toBeInTheDocument();
    cleanup();

    const { container: c2 } = render(
      <ContextUsageIndicator promptTokens={75_000} window={100_000} />
    );
    expect(c2.querySelector(".text-warning-solid")).toBeInTheDocument();
    cleanup();

    const { container: c3 } = render(
      <ContextUsageIndicator promptTokens={95_000} window={100_000} />
    );
    expect(c3.querySelector(".text-danger-solid")).toBeInTheDocument();
  });

  it("边界安全：tokens 超过上限时百分比截断为 100%", () => {
    render(<ContextUsageIndicator promptTokens={150_000} window={100_000} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("当传入 cumulativeTokens 时渲染累计消耗微标与对应数值", () => {
    render(
      <ContextUsageIndicator
        promptTokens={26_000}
        window={128_000}
        cumulativeTokens={95_200}
        cumulativeCostUsd={0.0145}
      />
    );

    const badge = screen.getByTestId("cumulative-tokens-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("消耗");
    expect(badge).toHaveTextContent("95.2k");
  });
});
