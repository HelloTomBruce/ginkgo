import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffViewer, computeLineDiff, parseUnifiedDiff } from "./DiffViewer";
import { ApprovalCard } from "./ApprovalCard";
import { TerminalViewer } from "./TerminalViewer";

describe("DiffViewer 差异计算与渲染", () => {
  it("computeLineDiff 能够正确识别新增、删除和不变行", () => {
    const orig = "const a = 1;\nconst b = 2;";
    const mod = "const a = 1;\nconst b = 3;\nconst c = 4;";
    const diff = computeLineDiff(orig, mod);

    expect(diff).toEqual([
      { type: "normal", text: "const a = 1;", oldLineNumber: 1, newLineNumber: 1 },
      { type: "delete", text: "const b = 2;", oldLineNumber: 2 },
      { type: "add", text: "const b = 3;", newLineNumber: 2 },
      { type: "add", text: "const c = 4;", newLineNumber: 3 },
    ]);
  });

  it("parseUnifiedDiff 能够解析标准 unified diff 文本", () => {
    const patch = `--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-hello\n+world`;
    const diff = parseUnifiedDiff(patch);
    expect(diff).toHaveLength(2);
    expect(diff[0].type).toBe("delete");
    expect(diff[0].text).toBe("hello");
    expect(diff[1].type).toBe("add");
    expect(diff[1].text).toBe("world");
  });

  it("渲染 DiffViewer 并支持展开与切换模式", () => {
    render(<DiffViewer original="foo" modified="bar" title="测试修改" />);
    expect(screen.getByText("测试修改")).toBeDefined();
    expect(screen.getByText("+1")).toBeDefined();
    expect(screen.getByText("-1")).toBeDefined();
  });
});

describe("ApprovalCard 人机协同审批卡", () => {
  it("待审批状态渲染批准和拒绝按钮，点击批准触发回调", () => {
    let approved = false;
    render(
      <ApprovalCard
        title="高危执行确认"
        riskLevel="danger"
        status="pending"
        onApprove={() => {
          approved = true;
        }}
      />
    );
    expect(screen.getByText("高危审批")).toBeDefined();
    const btn = screen.getByText("批准执行");
    fireEvent.click(btn);
    expect(approved).toBe(true);
  });

  it("支持输入拒绝原因并回传", () => {
    let rejectReason: string | undefined;
    render(
      <ApprovalCard
        title="删除文件"
        status="pending"
        onReject={(reason) => {
          rejectReason = reason;
        }}
      />
    );
    const rejectBtn = screen.getByText("拒绝");
    fireEvent.click(rejectBtn);

    const textarea = screen.getByPlaceholderText("告诉大模型为什么拒绝，或提出具体的修改建议...");
    fireEvent.change(textarea, { target: { value: "禁止删除核心文件" } });

    const confirmReject = screen.getByText("确认拒绝并回传");
    fireEvent.click(confirmReject);
    expect(rejectReason).toBe("禁止删除核心文件");
  });

  it("已批准状态显示已批准徽标", () => {
    render(<ApprovalCard title="已批准的任务" status="approved" />);
    expect(screen.getByText("已批准")).toBeDefined();
  });
});

describe("TerminalViewer 终端命令行卡", () => {
  it("渲染命令行与输出内容", () => {
    render(
      <TerminalViewer
        command="npm run build"
        output="Compiled successfully"
        exitCode={0}
        defaultOpen={true}
      />
    );
    expect(screen.getByText("npm run build")).toBeDefined();
    expect(screen.getByText("Compiled successfully")).toBeDefined();
    expect(screen.getByText("成功")).toBeDefined();
  });
});
