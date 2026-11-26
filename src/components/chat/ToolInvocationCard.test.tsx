import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ToolInvocationCard, normalizeModeEscalationPayload } from "./ToolInvocationCard";
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

  it("当工具结果包含 error 或 isError 时渲染未命中或异常徽标", () => {
    const tool: ToolInvocationState = {
      state: "result",
      toolCallId: "call-err",
      toolName: "browser_type",
      args: { what: "百度搜索框" },
      result: { success: false, error: "语义定位未命中", isError: true },
    };

    render(<ToolInvocationCard tool={tool} />);
    expect(screen.getByText("未命中或异常")).toBeDefined();
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

  it("当工具为 request_build_permission 时渲染 ModeApprovalCard，点击批准触发 onApproveEscalation", () => {
    const tool: ToolInvocationState = {
      state: "call",
      toolCallId: "call-escalation",
      toolName: "request_build_permission",
      args: {
        summary: "方案已推演完毕，申请切换至 Build 模式创建画板",
        changes: [
          { type: "file_create", target: "project/canvas.json", description: "项目配置" },
          { type: "file_modify", target: "project/Main.dc.html", description: "主画板" },
        ],
        riskLevel: "medium",
      },
    };

    let approvedPayload: unknown = null;
    render(
      <ToolInvocationCard
        tool={tool}
        onApproveEscalation={(p) => {
          approvedPayload = p;
        }}
      />
    );

    expect(screen.getByText("申请切换至构建模式 (Build)")).toBeDefined();
    expect(screen.getByText("方案已推演完毕，申请切换至 Build 模式创建画板")).toBeDefined();
    expect(screen.getByText("project/canvas.json")).toBeDefined();
    expect(screen.getByText("project/Main.dc.html")).toBeDefined();

    const approveBtn = screen.getByText("批准并开始构建");
    fireEvent.click(approveBtn);

    expect(approvedPayload).toMatchObject({
      targetMode: "build",
      summary: "方案已推演完毕，申请切换至 Build 模式创建画板",
    });
  });
});

describe("审批卡完成态与提权载荷边界", () => {
  it("审批规则命中的工具已完成执行（result 态）且用户未点击时，显示已批准而非永久审批中", () => {
    const tool: ToolInvocationState = {
      state: "result",
      toolCallId: "call-approved",
      toolName: "run_command",
      args: { command: "pnpm test" },
      result: { stdout: "ok", exitCode: 0 },
    };

    render(
      <ToolInvocationCard
        tool={tool}
        approvalRules={[
          { toolName: "run_command", riskLevel: "danger", title: "高危终端命令审批" },
        ]}
      />
    );

    expect(screen.getByText("已被人工批准执行")).toBeDefined();
    expect(screen.queryByText("批准执行")).toBeNull();
  });

  it("审批规则命中的工具仍在执行（call 态）时，保持审批中", () => {
    const tool: ToolInvocationState = {
      state: "call",
      toolCallId: "call-running",
      toolName: "run_command",
      args: { command: "pnpm build" },
    };

    render(
      <ToolInvocationCard
        tool={tool}
        approvalRules={[
          { toolName: "run_command", riskLevel: "warning", title: "命令审批" },
        ]}
      />
    );

    expect(screen.getByText("批准执行")).toBeDefined();
  });

  it("normalizeModeEscalationPayload: 过滤非法 changes 条目并兜底缺失字段", () => {
    const payload = normalizeModeEscalationPayload({
      changes: [
        { type: "file_create", target: "project/canvas.json", description: "画板配置" },
        { type: "evil_inject", target: "not-a-real-type" }, // 非法 type → 剔除
        { type: "file_modify" }, // 缺 target → 剔除
        { type: "command", target: "   " }, // 空 target → 剔除
        "not-an-object", // 非对象 → 剔除
        { type: "database", target: 42 }, // target 非字符串 → 剔除
        { type: "file_modify", target: "project/Main.dc.html" },
      ],
      // summary / riskLevel / actionPrompt 缺失 → 全部走兜底
    });

    expect(payload.changes).toEqual([
      { type: "file_create", target: "project/canvas.json", description: "画板配置" },
      { type: "file_modify", target: "project/Main.dc.html" },
    ]);
    expect(payload.summary).toContain("申请切换至构建模式");
    expect(payload.riskLevel).toBe("medium");
    expect(payload.actionPrompt).toBeUndefined();
    expect(payload.targetMode).toBe("build");
  });

  it("request_build_permission 脏数据经归一后仍可安全渲染审批卡", () => {
    const tool: ToolInvocationState = {
      state: "call",
      toolCallId: "call-dirty",
      toolName: "request_build_permission",
      args: {
        changes: [{ type: "hack", target: "<script>alert(1)</script>" }],
        riskLevel: "ultra",
      },
    };

    render(<ToolInvocationCard tool={tool} />);

    // 非法条目被剔除，卡片不渲染任何变更行
    expect(screen.getByText("申请切换至构建模式 (Build)")).toBeDefined();
    expect(screen.queryByText("<script>alert(1)</script>")).toBeNull();
    expect(screen.getByText("常规构建审批")).toBeDefined();
  });

  describe("默认工具卡片折叠展开与详情交互", () => {
    it("默认收起详细信息，点击头部可展开并展示入参与返回值", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-expand-1",
        toolName: "pg_execute_sql",
        args: { sql: "SELECT * FROM users LIMIT 10;" },
        result: [{ id: 1, name: "Alice" }],
      };

      render(
        <ToolInvocationCard
          tool={tool}
          activeSources={[{ id: "pg", name: "生产数据库" }]}
        />
      );

      // 默认未展开详情
      expect(screen.queryByTestId("tool-invocation-details")).toBeNull();
      expect(screen.getByTestId("chevron-right")).toBeDefined();

      // 点击展开
      const headerBtn = screen.getByRole("button", {
        name: /执行 SQL: SELECT \* FROM users LIMIT 10;/i,
      });
      fireEvent.click(headerBtn);

      // 展开后显示详情与参数、结果
      const details = screen.getByTestId("tool-invocation-details");
      expect(details).toBeDefined();
      expect(screen.getByTestId("chevron-down")).toBeDefined();
      expect(within(details).getByText(/SELECT \* FROM users LIMIT 10;/)).toBeDefined();
      expect(within(details).getByText(/"Alice"/)).toBeDefined();

      // 再次点击收起
      fireEvent.click(headerBtn);
      expect(screen.queryByTestId("tool-invocation-details")).toBeNull();
    });

    it("支持 defaultOpen={true} 初始展开", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-expand-2",
        toolName: "custom_fetch",
        args: { url: "https://api.example.com" },
        result: { status: 200 },
      };

      render(<ToolInvocationCard tool={tool} defaultOpen={true} />);

      expect(screen.getByTestId("tool-invocation-details")).toBeDefined();
      expect(screen.getByText(/https:\/\/api\.example\.com/)).toBeDefined();
    });

    it("工具运行中展开时显示等待返回提示", () => {
      const tool: ToolInvocationState = {
        state: "call",
        toolCallId: "call-running",
        toolName: "heavy_task",
        args: { timeout: 3000 },
      };

      render(<ToolInvocationCard tool={tool} defaultOpen={true} />);

      expect(screen.getByText("等待工具执行返回...")).toBeDefined();
    });

    it("工具执行失败或未命中时，展开区域显示错误信息", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-failed",
        toolName: "query_database",
        args: { sql: "INVALID SQL" },
        result: { error: "Syntax error at or near INVALID" },
      };

      render(<ToolInvocationCard tool={tool} defaultOpen={true} />);

      expect(screen.getByText("错误信息 (Error)")).toBeDefined();
      expect(screen.getByText(/Syntax error at or near INVALID/)).toBeDefined();
    });

    it("支持键盘 Enter 切换展开", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-keyboard",
        toolName: "test_tool",
      };

      render(<ToolInvocationCard tool={tool} />);

      const headerBtn = screen.getByRole("button");
      fireEvent.keyDown(headerBtn, { key: "Enter" });

      expect(screen.getByTestId("tool-invocation-details")).toBeDefined();
    });

    it("无入参与无返回值时展示空态文案", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-empty",
        toolName: "ping_tool",
      };

      render(<ToolInvocationCard tool={tool} defaultOpen={true} />);

      const details = screen.getByTestId("tool-invocation-details");
      expect(within(details).getByText("（无输入参数）")).toBeDefined();
      expect(within(details).getByText("（无返回值）")).toBeDefined();
    });

    it("空对象入参视为无参数", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-empty-args",
        toolName: "no_args_tool",
        args: {},
        result: "ok",
      };

      render(<ToolInvocationCard tool={tool} defaultOpen={true} />);

      const details = screen.getByTestId("tool-invocation-details");
      expect(within(details).getByText("（无输入参数）")).toBeDefined();
    });

    it("超长结果截断展示并提示，复制通道保留全文", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-long",
        toolName: "big_output",
        args: {},
        result: "x".repeat(50_001),
      };

      render(<ToolInvocationCard tool={tool} defaultOpen={true} />);

      const details = screen.getByTestId("tool-invocation-details");
      expect(within(details).getByText(/已截断展示前 50000 字符/)).toBeDefined();
      expect(within(details).getByText(/完整共 50001 字符/)).toBeDefined();
      // 复制按钮携带全文语义（剪贴板写入属浏览器环境行为，此处验证入口存在）
      expect(within(details).getByText("复制结果")).toBeDefined();
    });

    it("defaultOpen 变化可响应展开，用户显式收起后覆盖默认值", () => {
      const tool: ToolInvocationState = {
        state: "result",
        toolCallId: "call-reactive",
        toolName: "late_open",
        args: { a: 1 },
        result: { ok: true },
      };

      const { rerender } = render(<ToolInvocationCard tool={tool} defaultOpen={false} />);
      expect(screen.queryByTestId("tool-invocation-details")).toBeNull();

      // defaultOpen 翻转（如流式结束）→ 自动展开
      rerender(<ToolInvocationCard tool={tool} defaultOpen={true} />);
      expect(screen.getByTestId("tool-invocation-details")).toBeDefined();

      // 用户显式收起后，defaultOpen 保持 true 也不再自动展开（用户意图优先）
      fireEvent.click(screen.getByRole("button", { expanded: true }));
      expect(screen.queryByTestId("tool-invocation-details")).toBeNull();
      rerender(<ToolInvocationCard tool={tool} defaultOpen={true} />);
      expect(screen.queryByTestId("tool-invocation-details")).toBeNull();
    });
  });
});
