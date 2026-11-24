import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolInvocationCard } from "./ToolInvocationCard";
import type { ToolInvocationState } from "./contentBlocks";

describe("ToolInvocationCard 跨应用工具调用渲染调度器", () => {
  it("未匹配高级渲染器或审批规则时，回退渲染为默认胶囊徽标", () => {
    const tool: ToolInvocationState = {
      state: "result",
      toolCallId: "call-1",
      toolName: "some_custom_tool",
    };

    render(<ToolInvocationCard tool={tool} />);
    expect(screen.getByText("⚡ 工具调用: some_custom_tool")).toBeDefined();
    expect(screen.getByText("已完成")).toBeDefined();
  });

  it("匹配 diff 渲染器时，渲染 DiffViewer", () => {
    const tool: ToolInvocationState = {
      state: "result",
      toolCallId: "call-2",
      toolName: "edit_file",
      args: {
        path: "src/index.ts",
        target: "const x = 1;",
        replacement: "const x = 2;",
      },
    };

    render(
      <ToolInvocationCard
        tool={tool}
        toolRenderers={[
          {
            toolName: "edit_file",
            renderer: "diff",
            title: "代码变更审阅",
          },
        ]}
      />
    );

    expect(screen.getByText("代码变更审阅")).toBeDefined();
    expect(screen.getByText("+1")).toBeDefined();
    expect(screen.getByText("-1")).toBeDefined();
  });

  it("匹配 terminal 渲染器时，渲染 TerminalViewer", () => {
    const tool: ToolInvocationState = {
      state: "result",
      toolCallId: "call-3",
      toolName: "run_command",
      args: {
        command: "pnpm test",
      },
      result: {
        stdout: "All tests passed",
        exitCode: 0,
      },
    };

    render(
      <ToolInvocationCard
        tool={tool}
        toolRenderers={[
          {
            toolName: "run_command",
            renderer: "terminal",
            defaultOpen: true,
          },
        ]}
      />
    );

    expect(screen.getByText("pnpm test")).toBeDefined();
    expect(screen.getByText("All tests passed")).toBeDefined();
    expect(screen.getByText("成功")).toBeDefined();
  });

  it("匹配 approvalRules 时拦截渲染 ApprovalCard，支持批准回调", () => {
    const tool: ToolInvocationState = {
      state: "call",
      toolCallId: "call-4",
      toolName: "run_command",
      args: {
        command: "rm -rf build",
      },
    };

    let dispatchedAction = "";
    render(
      <ToolInvocationCard
        tool={tool}
        approvalRules={[
          {
            toolName: "run_command",
            riskLevel: "danger",
            title: "高危终端命令审批",
            condition: (args) => String(args.command).includes("rm -rf"),
          },
        ]}
        onRendererAction={(prompt) => {
          dispatchedAction = prompt;
        }}
      />
    );

    expect(screen.getByText("高危终端命令审批")).toBeDefined();
    expect(screen.getByText("高危审批")).toBeDefined();

    const approveBtn = screen.getByText("批准执行");
    fireEvent.click(approveBtn);

    expect(dispatchedAction).toContain("[人工批准]");
    expect(dispatchedAction).toContain("run_command");
    expect(dispatchedAction).toContain("高危终端命令审批");
  });
});
