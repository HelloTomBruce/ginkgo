import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RankingList } from "./RankingList";

afterEach(cleanup);

describe("RankingList 排行榜组件", () => {
  const testItems = [
    { label: "自然搜索 (Organic)", value: 45000, secondary: "+12%" },
    { label: "信息流广告 (Feeds)", value: 32000, secondary: "+8%" },
    { label: "短视频带货 (ShortVideo)", value: 28000 },
    { label: "邮件召回 (Email)", value: 15000 },
    { label: "渠道合作 (Affiliate)", value: 9800 },
    { label: "社交裂变 (Social)", value: 4200 },
  ];

  it("正常渲染标题与前 5 项排行", () => {
    render(
      <RankingList
        title="获客渠道 Top 排行"
        subtitle="2026年Q3数据"
        items={testItems}
        maxDisplay={5}
      />
    );

    expect(screen.getByText("获客渠道 Top 排行")).toBeInTheDocument();
    expect(screen.getByText("2026年Q3数据")).toBeInTheDocument();
    expect(screen.getByText("自然搜索 (Organic)")).toBeInTheDocument();
    expect(screen.getByText("渠道合作 (Affiliate)")).toBeInTheDocument();
    // 第6项默认被折叠
    expect(screen.queryByText("社交裂变 (Social)")).toBeNull();
    // 存在展开按钮
    expect(screen.getByText(/查看更多 \(1\)/)).toBeInTheDocument();
  });

  it("点击展开按钮可查看超出限制的项，再次点击收起", () => {
    render(<RankingList items={testItems} maxDisplay={5} />);
    const expandBtn = screen.getByText(/查看更多/);
    fireEvent.click(expandBtn);
    expect(screen.getByText("社交裂变 (Social)")).toBeInTheDocument();

    const collapseBtn = screen.getByText("收起");
    fireEvent.click(collapseBtn);
    expect(screen.queryByText("社交裂变 (Social)")).toBeNull();
  });

  it("支持货币与百分比格式化", () => {
    render(
      <RankingList
        items={[{ label: "转化率最高", value: 0.385 }]}
        valueFormat="percent"
      />
    );
    expect(screen.getByText("38.5%")).toBeInTheDocument();
  });

  it("空数据或异常数据时不崩溃并优雅兜底", () => {
    render(<RankingList items={null as unknown as []} />);
    expect(screen.getByText("暂无排行数据")).toBeInTheDocument();
  });
});
