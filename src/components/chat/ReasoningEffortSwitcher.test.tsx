import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReasoningEffortSwitcher } from "./ReasoningEffortSwitcher";

describe("ReasoningEffortSwitcher", () => {
  it("当模型为常规对话模型时，不展示任何内容", () => {
    const { container } = render(
      <ReasoningEffortSwitcher
        model="gpt-4o-mini"
        reasoningEffort="medium"
        onReasoningEffortChange={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("当模型为深度思考模型时，展示触发按钮及当前思考等级", () => {
    render(
      <ReasoningEffortSwitcher
        model="o3-mini"
        reasoningEffort="medium"
        onReasoningEffortChange={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /推理等级/ });
    expect(button).toBeInTheDocument();
    expect(screen.getByText("思考: 中")).toBeInTheDocument();
  });

  it("点击按钮可展开下拉弹层，并切换思考预算等级", () => {
    const onReasoningEffortChange = vi.fn();
    render(
      <ReasoningEffortSwitcher
        model="deepseek-reasoner"
        reasoningEffort="medium"
        onReasoningEffortChange={onReasoningEffortChange}
      />
    );

    const button = screen.getByRole("button", { name: /推理等级/ });
    fireEvent.click(button);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("思考预算（Reasoning Effort）")).toBeInTheDocument();
    expect(screen.getByText("Low (低)")).toBeInTheDocument();
    expect(screen.getByText("High (高)")).toBeInTheDocument();

    // 点击 High
    fireEvent.click(screen.getByRole("option", { name: /High/ }));
    expect(onReasoningEffortChange).toHaveBeenCalledWith("high");

    // 弹层已自动关闭
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("支持通过 supportsReasoning 显式开启或覆盖启发式推断", () => {
    // 1. 自定义模型通过 supportsReasoning: true 强制开启
    const { rerender } = render(
      <ReasoningEffortSwitcher
        model="my-custom-model"
        supportsReasoning={true}
        reasoningEffort="medium"
        onReasoningEffortChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /推理等级/ })).toBeInTheDocument();

    // 2. 原本按名称命中的模型通过 supportsReasoning: false 强制关闭
    rerender(
      <ReasoningEffortSwitcher
        model="o3-mini"
        supportsReasoning={false}
        reasoningEffort="medium"
        onReasoningEffortChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /推理等级/ })).not.toBeInTheDocument();
  });
});
