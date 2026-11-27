import { describe, it, expect, vi } from "vitest";

const { stubExecute } = vi.hoisted(() => ({ stubExecute: vi.fn() }));

// 桩掉 dsh-browser 工具收集：注入可受控抛错的假工具定义，
// 直接验证 @ginkgolab/browser 执行包装层的异常收敛与取消透传策略
vi.mock("dsh-browser-view/mcp", () => ({
  collectToolDefinitions: () =>
    new Map([
      [
        "browser_open",
        {
          description: "打开网页（测试桩）",
          parameters: { type: "object", properties: {} },
          execute: stubExecute,
        },
      ],
    ]),
}));

import { createBrowserTools } from "./tools";

describe("@ginkgolab/browser 工具执行异常收敛与取消语义", () => {
  it("普通异常收敛为结构化失败结果，不向上抛出", async () => {
    stubExecute.mockRejectedValueOnce(new Error("boom"));

    const pkg = createBrowserTools({ sessionId: "s_err", workspaceDir: "/tmp/gb-err" });
    const res = (await pkg.tools.browser_open.execute!(
      {},
      { messages: [], toolCallId: "t_err" }
    )) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(res.isError).toBe(true);
    // toolFailure 工厂以工具名前缀注入 error，便于多工具会话失败溯源
    expect(res.error).toBe("[browser_open] boom");
  });

  it("AbortError 透传取消语义，绝不吞为失败结果", async () => {
    const abortErr = new Error("用户中止");
    abortErr.name = "AbortError";
    stubExecute.mockRejectedValueOnce(abortErr);

    const pkg = createBrowserTools({ sessionId: "s_abort", workspaceDir: "/tmp/gb-abort" });
    await expect(
      pkg.tools.browser_open.execute!({}, { messages: [], toolCallId: "t_abort" })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
