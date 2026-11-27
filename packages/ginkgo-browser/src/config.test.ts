import path from "node:path";
import { describe, it, expect, vi } from "vitest";

const { stubExecute, captured } = vi.hoisted(() => {
  const captured: { current?: Record<string, unknown> } = { current: undefined };
  return { stubExecute: vi.fn(), captured };
});

// 桩掉 dsh-browser 工具收集：捕获装配配置以验证目录派生与命名空间语义
vi.mock("dsh-browser-view/mcp", () => ({
  collectToolDefinitions: (cfg: unknown) => {
    captured.current = cfg as Record<string, unknown>;
    return new Map([
      [
        "browser_open",
        {
          description: "打开网页（测试桩）",
          parameters: { type: "object", properties: {} },
          execute: stubExecute,
        },
      ],
    ]);
  },
}));

import { createBrowserTools } from "./tools";

describe("@ginkgolab/browser 装配配置派生", () => {
  it("产物目录基于 workspaceDir 以平台路径分隔符派生，并绑定会话作用域", () => {
    const workspaceDir = path.join(path.sep, "tmp", "gb-cfg");
    createBrowserTools({ sessionId: "s_cfg", workspaceDir });

    const cfg = captured.current;
    expect(cfg).toBeDefined();
    expect(cfg?.screenshotDir).toBe(path.join(workspaceDir, "screenshots"));
    expect(cfg?.downloadDir).toBe(path.join(workspaceDir, "downloads"));
    expect(cfg?.baselineDir).toBe(path.join(workspaceDir, "baselines"));
    expect(cfg?.workspaceDir).toBe(workspaceDir);
    expect(cfg?.scope).toBe("session");
  });
});
