import { describe, it, expect } from "vitest";
import {
  createBrowserTools,
  READONLY_BROWSER_TOOLS,
  buildBrowserPromptSection,
} from "./index";

describe("@ginkgo/browser 浏览器能力包", () => {
  const defaultOptions = {
    sessionId: "test-session-123",
    workspaceDir: "/tmp/ginkgo-test-workspace",
  };

  describe("工具生成与工具集规模", () => {
    it("默认 core 工具集导出高频核心自动化工具", () => {
      const pkg = createBrowserTools({
        ...defaultOptions,
        toolset: "core",
        permissionLevel: "full",
      });

      expect(pkg.toolNames.length).toBeGreaterThanOrEqual(20);
      expect(pkg.tools.browser_open).toBeDefined();
      expect(pkg.tools.browser_click).toBeDefined();
      expect(pkg.tools.browser_type).toBeDefined();
      expect(pkg.tools.browser_find).toBeDefined();
      expect(pkg.tools.browser_snapshot).toBeDefined();
      expect(pkg.tools.browser_screenshot).toBeDefined();
    });

    it("all 工具集包含高级录制、回放与批量表单工具", () => {
      const corePkg = createBrowserTools({
        ...defaultOptions,
        toolset: "core",
        permissionLevel: "full",
      });
      const allPkg = createBrowserTools({
        ...defaultOptions,
        toolset: "all",
        permissionLevel: "full",
      });

      expect(allPkg.toolNames.length).toBeGreaterThan(corePkg.toolNames.length);
      expect(allPkg.tools.browser_record).toBeDefined();
      expect(allPkg.tools.browser_replay).toBeDefined();
      expect(allPkg.tools.browser_form_fill).toBeDefined();
    });
  });

  describe("权限档控制 (Permission Levels)", () => {
    it("readonly 模式只保留无副作用探查工具，严禁写操作", () => {
      const pkg = createBrowserTools({
        ...defaultOptions,
        permissionLevel: "readonly",
      });

      // 绝不包含任何写副作用工具
      expect(pkg.tools.browser_click).toBeUndefined();
      expect(pkg.tools.browser_type).toBeUndefined();
      expect(pkg.tools.browser_press).toBeUndefined();
      expect(pkg.tools.browser_drag).toBeUndefined();
      expect(pkg.tools.browser_form_fill).toBeUndefined();
      expect(pkg.tools.browser_eval).toBeUndefined();

      // 只读探查工具完备
      expect(pkg.tools.browser_open).toBeDefined();
      expect(pkg.tools.browser_snapshot).toBeDefined();
      expect(pkg.tools.browser_find).toBeDefined();
      expect(pkg.tools.browser_elements).toBeDefined();
      expect(pkg.tools.browser_screenshot).toBeDefined();
      expect(pkg.tools.browser_network).toBeDefined();

      // 确认所有导出的工具都在只读白名单内
      for (const name of pkg.toolNames) {
        expect(READONLY_BROWSER_TOOLS.has(name)).toBe(true);
      }
    });

    it("full 模式包含全量交互工具", () => {
      const pkg = createBrowserTools({
        ...defaultOptions,
        permissionLevel: "full",
      });

      expect(pkg.tools.browser_click).toBeDefined();
      expect(pkg.tools.browser_type).toBeDefined();
      expect(pkg.tools.browser_select).toBeDefined();
      expect(pkg.tools.browser_batch).toBeDefined();
    });
  });

  describe("工具结构与参数规范", () => {
    it("导出的每个工具都满足 Vercel AI SDK Tool 接口契约", () => {
      const pkg = createBrowserTools(defaultOptions);

      for (const toolInstance of Object.values(pkg.tools)) {
        expect(toolInstance.description).toBeDefined();
        expect(typeof toolInstance.description).toBe("string");
        expect(toolInstance.description?.length).toBeGreaterThan(0);
        expect(toolInstance.parameters).toBeDefined();
        expect(typeof toolInstance.execute).toBe("function");
      }
    });
  });

  describe("系统提示词生成", () => {
    it("只读模式提示词强调 Plan 阶段无副作用约束", () => {
      const prompt = buildBrowserPromptSection("readonly");
      expect(prompt).toContain("只读探查模式（Plan 阶段）");
      expect(prompt).toContain("严禁执行点击、输入");
      expect(prompt).toContain("what");
    });

    it("全功能模式提示词强调 Build 执行阶段能力", () => {
      const prompt = buildBrowserPromptSection("full");
      expect(prompt).toContain("全功能交互模式");
      expect(prompt).toContain("智能表单填充");
    });
  });

  describe("生命周期与清理", () => {
    it("提供平稳释放句柄 dispose 函数", async () => {
      const pkg = createBrowserTools(defaultOptions);
      expect(typeof pkg.dispose).toBe("function");
      await expect(pkg.dispose()).resolves.not.toThrow();
    });
  });

  describe("异常捕获与流式收敛", () => {
    // 该用例会真实尝试连接浏览器并以失败收敛（本地 ~1.6s）。CI runner 明显更慢，
    // 5s 默认超时不够；这里显式放宽用例超时，并把底层连接超时收窄到 3s，
    // 让失败路径在慢机器上仍能确定性地走完。
    it(
      "工具执行失败时优雅收敛为结构化结果，绝不抛错阻断会话流",
      async () => {
      const pkg = createBrowserTools({ ...defaultOptions, timeoutMs: 3000 });
      const clickTool = pkg.tools.browser_click;
      const res = (await clickTool.execute!(
        { what: "不存在的目标元素" },
        { messages: [], toolCallId: "test-fail-1" }
      )) as Record<string, unknown>;

      expect(res.success).toBe(false);
      expect(res.isError).toBe(true);
      expect(typeof res.error).toBe("string");
      },
      20_000
    );
  });
});
