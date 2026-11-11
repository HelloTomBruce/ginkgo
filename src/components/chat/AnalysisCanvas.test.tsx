import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AnalysisCanvas } from "./AnalysisCanvas";

afterEach(cleanup);

describe("AnalysisCanvas 分析画布组件", () => {
  it("无数据时渲染空态引导", () => {
    render(<AnalysisCanvas data={null} onClose={vi.fn()} />);
    expect(screen.getByText("分析画布已就绪")).toBeInTheDocument();
  });

  it("有数据时渲染标题与 OpenUIRenderer 内容", () => {
    const dsl = 'root = Root([MetricCard("销售额", "120万")])';
    render(
      <AnalysisCanvas
        data={{ id: "msg-1", title: "获客分析", dsl }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("获客分析")).toBeInTheDocument();
    expect(screen.getByText("销售额")).toBeInTheDocument();
  });

  it("点击收起按钮触发 onClose 回调", () => {
    const onClose = vi.fn();
    render(
      <AnalysisCanvas
        data={{ id: "msg-1", title: "获客分析", dsl: "" }}
        onClose={onClose}
      />
    );
    const closeBtn = screen.getByRole("button", { name: "关闭画布" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("活看板状态下点击刷新按钮触发 onRefresh 回调", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <AnalysisCanvas
        data={{ id: "msg-1", title: "获客分析", dsl: "", isLive: true }}
        onClose={vi.fn()}
        onRefresh={onRefresh}
      />
    );
    const refreshBtn = screen.getByRole("button", { name: "刷新看板" });
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledWith("msg-1");
  });

  it("静态快照（非活看板）刷新按钮禁用", () => {
    render(
      <AnalysisCanvas
        data={{ id: "msg-1", title: "静态获客分析", dsl: "", isLive: false }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    const refreshBtn = screen.getByRole("button", { name: "刷新看板" });
    expect(refreshBtn).toBeDisabled();
  });

  it("支持父级受控全屏切换，点击全屏按钮触发 onToggleExpand", () => {
    const onToggleExpand = vi.fn();
    const { rerender } = render(
      <AnalysisCanvas
        data={{ id: "msg-1", title: "看板", dsl: "" }}
        onClose={vi.fn()}
        isExpanded={false}
        onToggleExpand={onToggleExpand}
      />
    );

    const expandBtn = screen.getByRole("button", { name: "全屏" });
    fireEvent.click(expandBtn);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);

    // 重新渲染为已全屏状态，文案变为还原且容器不含 fixed 遮罩
    rerender(
      <AnalysisCanvas
        data={{ id: "msg-1", title: "看板", dsl: "" }}
        onClose={vi.fn()}
        isExpanded={true}
        onToggleExpand={onToggleExpand}
      />
    );
    expect(screen.getByRole("button", { name: "还原" })).toBeInTheDocument();
    const aside = screen.getByRole("complementary", { name: "分析画布" });
    expect(aside.className).not.toContain("fixed inset-0");
    expect(aside.className).toContain("h-full w-full");
  });
});
