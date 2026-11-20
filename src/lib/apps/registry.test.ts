import { describe, it, expect } from "vitest";
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
});
