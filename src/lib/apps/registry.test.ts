import { describe, it, expect, vi } from "vitest";
import { appRegistry, getDefaultApp, getApp, listApps, DEFAULT_APP_ID } from "./registry";
import type { AppDefinition } from "@/types/app";

describe("AppRegistry 应用注册表", () => {
  it("默认内置注册了 analytics 数据分析应用与 general 通用助手", () => {
    const defaultApp = getDefaultApp();
    expect(defaultApp).toBeDefined();
    expect(defaultApp.manifest.id).toBe(DEFAULT_APP_ID);
    expect(defaultApp.manifest.name).toBe("智能数据分析师");
    expect(defaultApp.client.hasWorkspace).toBe(true);

    const general = getApp("general");
    expect(general).toBeDefined();
    expect(general?.manifest.name).toBe("通用智能助手");
    expect(general?.client.hasWorkspace).toBe(true);
    expect(general?.client.workspaceTitle).toBe("工作区产物");

    const design = getApp("design");
    expect(design).toBeDefined();
    expect(design?.manifest.name).toBe("体验设计工坊");
    expect(design?.client.hasWorkspace).toBe(true);
    expect(design?.client.workspaceTitle).toBe("设计工作台");
  });

  it("支持通过 get 和 getOrDefault 查询应用", () => {
    const app = getApp("analytics");
    expect(app).toBeDefined();
    expect(app?.manifest.id).toBe("analytics");

    // 不存在的应用 get 返回 undefined
    expect(getApp("non_existent")).toBeUndefined();

    // getOrDefault 不存在时回落到 analytics
    expect(appRegistry.getOrDefault("non_existent").manifest.id).toBe("analytics");
    expect(appRegistry.getOrDefault(undefined).manifest.id).toBe("analytics");
  });

  it("支持动态注册新应用并能列出", () => {
    const demoApp: AppDefinition = {
      manifest: {
        id: "demo-app",
        name: "演示测试应用",
        description: "测试注册能力",
        icon: "Bot",
      },
      client: {
        welcomeMessage: "测试欢迎语",
        presetQueries: [],
      },
      server: {
        buildSystemPrompt: () => "demo prompt",
      },
    };

    appRegistry.register(demoApp);
    expect(appRegistry.has("demo-app")).toBe(true);
    expect(getApp("demo-app")?.manifest.name).toBe("演示测试应用");

    const all = listApps();
    expect(all.some((a) => a.manifest.id === "demo-app")).toBe(true);
  });

  it("注册时校验能力词汇表：未知能力告警不拦截，已知能力不告警", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // 未知能力：warn 且注册成功（不 block，前向兼容第三方应用）
      appRegistry.register({
        manifest: { id: "cap-demo", name: "能力校验演示", description: "", icon: "Bot" },
        client: { welcomeMessage: "", presetQueries: [] },
        server: {
          buildSystemPrompt: () => "",
          requiredCapabilities: ["workspace_sandbox", "totally_unknown_cap"],
        },
      } as unknown as Parameters<typeof appRegistry.register>[0]);
      expect(appRegistry.has("cap-demo")).toBe(true);
      const unknownWarns = warnSpy.mock.calls.filter((c) =>
        c.join(" ").includes("totally_unknown_cap")
      );
      expect(unknownWarns).toHaveLength(1);

      // 全部已知能力：不产生任何告警
      appRegistry.register({
        manifest: { id: "cap-ok-app", name: "能力合法演示", description: "", icon: "Bot" },
        client: { welcomeMessage: "", presetQueries: [] },
        server: {
          buildSystemPrompt: () => "",
          requiredCapabilities: ["workspace_sandbox", "browser"],
        },
      } as unknown as Parameters<typeof appRegistry.register>[0]);
      const okWarns = warnSpy.mock.calls.filter((c) => c.join(" ").includes("cap-ok-app"));
      expect(okWarns).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
