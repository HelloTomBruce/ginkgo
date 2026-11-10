import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricCard } from "./MetricCard";

afterEach(cleanup);

describe("MetricCard 指标卡", () => {
  it("正常渲染标题、数值、变化率及补充说明", () => {
    render(
      <MetricCard
        title="总线索数"
        value="12,480"
        change="+18.2%"
        trend="up"
        subtext="环比 Q2 显著提升"
      />
    );
    expect(screen.getByText("总线索数")).toBeInTheDocument();
    expect(screen.getByText("12,480")).toBeInTheDocument();
    expect(screen.getByText("+18.2%")).toBeInTheDocument();
    expect(screen.getByText("环比 Q2 显著提升")).toBeInTheDocument();
  });

  it("超长数字/金额完整展示不截断（无省略号），通过自适应字号与折行保证可读性", () => {
    const longValue = "$2,332,440.00 CNY";
    render(
      <MetricCard
        title="标杆企业级客户年度经常性收入贡献"
        value={longValue}
        change="+126.8% YoY"
        trend="up"
        subtext="包含 24 家超大客户合同总额，较去年同期翻倍"
      />
    );

    const valueEl = screen.getByText(longValue);
    expect(valueEl).toBeInTheDocument();
    // 关键业务指标严禁使用 truncate 截断省略，确保所有数字直接可见
    expect(valueEl.className).not.toContain("truncate");
    expect(valueEl.className).toContain("break-all");
    expect(valueEl.className).toContain("tabular-nums");

    // 标题支持自然折行，不截断
    const titleEl = screen.getByText("标杆企业级客户年度经常性收入贡献");
    expect(titleEl.className).toContain("break-words");
    expect(titleEl.className).not.toContain("truncate");

    // 说明文案支持自然多行折行展开，不切断上下文
    const subtextEl = screen.getByText("包含 24 家超大客户合同总额，较去年同期翻倍");
    expect(subtextEl.className).toContain("break-words");
    expect(subtextEl.className).not.toContain("line-clamp");
  });

  it("变化率徽章与主数值采用 flex-wrap 弹性换行，空间紧凑时自动换行而不挤压数值", () => {
    const longChange = "+45.8% 环比增长（超额达成）";
    const { container } = render(
      <MetricCard
        title="转化率"
        value="38.5%"
        change={longChange}
        trend="up"
      />
    );

    const changeEl = screen.getByText(longChange);
    expect(changeEl).toBeInTheDocument();
    expect(changeEl.className).toContain("whitespace-nowrap");

    // 检查包裹容器具有 flex-wrap 特性
    const flexRow = container.querySelector(".flex-wrap");
    expect(flexRow).not.toBeNull();
  });

  it("容器根节点具备 min-w-0 和 h-full，保障栅格卡片高度对齐且不撑破父级", () => {
    const { container } = render(
      <MetricCard title="指标" value="100" />
    );
    const cardRoot = container.firstChild as HTMLElement;
    expect(cardRoot.className).toContain("min-w-0");
    expect(cardRoot.className).toContain("h-full");
    expect(cardRoot.className).toContain("flex-col");
  });

  it("当数值为 null/undefined/object 时安全兜底，不发生运行时崩溃", () => {
    render(<MetricCard title="空指标" value={undefined as unknown as string} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
