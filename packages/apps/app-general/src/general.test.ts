import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildGeneralSystemPrompt } from "./prompt";
import { getGeneralTools, dispatchGeneralAction, onSessionEnd } from "./server/index";

describe("app-general 通用助手浏览器与沙箱能力集成", () => {
  const mockCtx = {
    appId: "general",
    sessionId: "test-sess-general-1",
    workspace: {
      appId: "general",
      sandboxDir: "/tmp/ginkgo-general-test",
    },
  };

  describe("系统提示词组装 (buildGeneralSystemPrompt)", () => {
    it("包含沙箱工具与浏览器自动化规范段落", () => {
      const prompt = buildGeneralSystemPrompt({
        ...mockCtx,
        mode: "direct",
      });

      expect(prompt).toContain("通用智能助手");
      expect(prompt).toContain("网页浏览与自动化操作");
      expect(prompt).toContain("read_file");
      expect(prompt).toContain("write_file");
      expect(prompt).toContain("browser_*");
      expect(prompt).toContain("意图语义定位（what）");
    });

    it("Plan 模式下输出只读限制提示", () => {
      const prompt = buildGeneralSystemPrompt({
        ...mockCtx,
        mode: "plan",
      });

      expect(prompt).toContain("Plan 规划模式");
      expect(prompt).toContain("只读探查模式（Plan 阶段）");
      expect(prompt).toContain("严禁执行点击、输入");
    });

    it("Execute / Direct 模式下输出全功能交互提示", () => {
      const prompt = buildGeneralSystemPrompt({
        ...mockCtx,
        mode: "execute",
      });

      expect(prompt).toContain("Build / Execute 执行构建模式");
      expect(prompt).toContain("全功能交互模式");
    });
  });

  describe("工具装配 (getGeneralTools)", () => {
    it("Direct 模式导出沙箱与全功能浏览器核心工具集", () => {
      const tools = getGeneralTools({
        ...mockCtx,
        mode: "direct",
      });

      // 验证沙箱原子四工具
      expect(tools.read_file).toBeDefined();
      expect(tools.write_file).toBeDefined();
      expect(tools.edit_file).toBeDefined();
      expect(tools.run_command).toBeDefined();

      // 验证浏览器自动化核心工具
      expect(tools.browser_open).toBeDefined();
      expect(tools.browser_snapshot).toBeDefined();
      expect(tools.browser_find).toBeDefined();
      expect(tools.browser_screenshot).toBeDefined();
      expect(tools.browser_click).toBeDefined();
      expect(tools.browser_type).toBeDefined();
      expect(tools.browser_select).toBeDefined();
    });

    it("Plan 模式下沙箱与浏览器工具均自动降级为只读探查", () => {
      const tools = getGeneralTools({
        ...mockCtx,
        mode: "plan",
      });

      // 沙箱写操作收敛
      expect(tools.read_file).toBeDefined();
      expect(tools.write_file).toBeUndefined();
      expect(tools.edit_file).toBeUndefined();
      expect(tools.run_command).toBeUndefined();

      // 浏览器写副作用收敛
      expect(tools.browser_open).toBeDefined();
      expect(tools.browser_snapshot).toBeDefined();
      expect(tools.browser_find).toBeDefined();
      expect(tools.browser_click).toBeUndefined();
      expect(tools.browser_type).toBeUndefined();
      expect(tools.browser_press).toBeUndefined();
    });
  });

  describe("动作分发网关 (dispatchGeneralAction)", () => {
    it("browser_status: 目录为空时优雅返回空产物列表", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-gen-action-"));
      try {
        const result = (await dispatchGeneralAction(
          "browser_status",
          {},
          { appId: "general", sessionId: "sess-1", workspaceDir: tempDir }
        )) as {
          status: string;
          hasScreenshots: boolean;
          hasDownloads: boolean;
          screenshots: unknown[];
          downloads: unknown[];
        };

        expect(result.status).toBe("ready");
        expect(result.hasScreenshots).toBe(false);
        expect(result.hasDownloads).toBe(false);
        expect(result.screenshots).toEqual([]);
        expect(result.downloads).toEqual([]);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("browser_status: 自动发现并排序截图与下载文件", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-gen-action-"));
      try {
        const screenshotsDir = path.join(tempDir, "screenshots");
        const downloadsDir = path.join(tempDir, "downloads");
        await fs.mkdir(screenshotsDir, { recursive: true });
        await fs.mkdir(downloadsDir, { recursive: true });

        await fs.writeFile(path.join(screenshotsDir, "shot1.png"), "fake-png-data");
        await fs.writeFile(path.join(downloadsDir, "report.pdf"), "fake-pdf-data");

        const result = (await dispatchGeneralAction(
          "browser_status",
          {},
          { appId: "general", sessionId: "sess-1", workspaceDir: tempDir }
        )) as {
          status: string;
          hasScreenshots: boolean;
          hasDownloads: boolean;
          screenshots: Array<{ name: string; path: string }>;
          downloads: Array<{ name: string; path: string }>;
        };

        expect(result.status).toBe("ready");
        expect(result.hasScreenshots).toBe(true);
        expect(result.hasDownloads).toBe(true);
        expect(result.screenshots[0].name).toBe("shot1.png");
        expect(result.screenshots[0].path).toBe("screenshots/shot1.png");
        expect(result.downloads[0].name).toBe("report.pdf");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    // 真实浏览器动作：CI runner 慢于本地，5s 默认超时不足以走完连接失败路径
    it("browser_capture_screenshot: 正常响应或优雅捕获错误状态", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-gen-action-"));
      try {
        const result = (await dispatchGeneralAction(
          "browser_capture_screenshot",
          {},
          { appId: "general", sessionId: "sess-1", workspaceDir: tempDir }
        )) as { success: boolean; error?: string; screenshot?: { path: string } };

        expect(result).toHaveProperty("success");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }, 20_000);

    it("未知 action 抛出显式异常", async () => {
      await expect(
        dispatchGeneralAction(
          "unknown_action",
          {},
          { appId: "general", sessionId: "sess-1", workspaceDir: "/tmp" }
        )
      ).rejects.toThrow("Unknown general action: unknown_action");
    });
  });

  describe("会话终止钩子 (onSessionEnd)", () => {
    it("释放会话级浏览器资源缓存且幂等可重入", async () => {
      // 无缓存条目时安全空跑；有缓存条目时逐个 dispose 并淘汰（进程级，无泄漏面）
      await expect(onSessionEnd("sess-1")).resolves.toBeUndefined();
      await expect(onSessionEnd("sess-1")).resolves.toBeUndefined();
      await expect(onSessionEnd("不存在的会话")).resolves.toBeUndefined();
    });
  });
});
