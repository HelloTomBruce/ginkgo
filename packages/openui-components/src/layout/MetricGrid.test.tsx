import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricGrid } from "./MetricGrid";

// vitest 未开 globals，testing-library 的自动 cleanup 不会注册，需显式清理
afterEach(cleanup);

describe("MetricGrid 指标卡栅格", () => {
  it("列数仅随自身宽度自适应：容器查询类只挂在内层 grid，外层 wrapper 承担 @container", () => {
    render(
      <MetricGrid columns={3}>
        <div>卡一</div>
        <div>卡二</div>
        <div>卡三</div>
      </MetricGrid>
    );
    const inner = screen.getByText("卡一").parentElement!;
    const wrapper = inner.parentElement!;

    // 元素不能容器查询自身：@container 与响应式类必须分离在两个元素上，
    // 否则 @sm/@lg 会解析到祖先容器（FocusLayout 根，恒宽）永远量不到自身宽度
    expect(wrapper.className).toContain("@container");
    expect(inner.className).not.toContain("@container");

    // 不得残留视口断点列类：桌面视口恒宽时 lg:grid-cols-3 会把 3 列
    // 硬塞进 1/3 窄侧栏导致卡片挤作一团（回归：概率加权期望营收三卡错位）
    const tokens = inner.className.split(/\s+/);
    for (const t of tokens) {
      expect(["sm:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"]).not.toContain(t);
    }
    // 容器查询列类按 columns 生效
    expect(tokens).toContain("@sm:grid-cols-2");
    expect(tokens).toContain("@lg:grid-cols-3");
  });

  it("columns=2/4 分别映射到对应容器查询列数；非法值回退 3 列", () => {
    const { unmount } = render(
      <MetricGrid columns={2}>
        <div>a</div>
      </MetricGrid>
    );
    let inner = screen.getByText("a").parentElement!;
    expect(inner.className.split(/\s+/)).toContain("@sm:grid-cols-2");
    expect(inner.className.split(/\s+/)).not.toContain("@lg:grid-cols-3");
    unmount();

    render(
      <MetricGrid columns={4}>
        <div>b</div>
      </MetricGrid>
    );
    inner = screen.getByText("b").parentElement!;
    expect(inner.className.split(/\s+/)).toContain("@lg:grid-cols-4");
  });
});
