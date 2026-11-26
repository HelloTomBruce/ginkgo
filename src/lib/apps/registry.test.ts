import { describe, it, expect, vi } from "vitest";
import { AppRegistry, appRegistry, DEFAULT_APP_ID } from "./registry";
import type { AppPackageDefinition } from "@ginkgo/app-sdk";

describe("AppRegistry 配置驱动注册表", () => {
  it("初始化时按传入的配置正确加载应用与排序", () => {
    const registry = new AppRegistry({
      apps: [
        { id: "design", package: "@ginkgo-apps/design", enabled: true },
        { id: "analytics", package: "@ginkgo-apps/analytics", enabled: true },
      ],
    });

    const list = registry.list();
    expect(list.map((a) => a.manifest.id)).toEqual(["design", "analytics"]);
  });

  it("当配置中 enabled 为 false 时，应用被屏蔽不出现在 list() 中", () => {
    const registry = new AppRegistry({
      apps: [
        { id: "analytics", enabled: true },
        { id: "general", enabled: false },
        { id: "design", enabled: true },
      ],
    });

    const list = registry.list();
    expect(list.map((a) => a.manifest.id)).toEqual(["analytics", "design"]);
    expect(registry.isAppEnabled("general")).toBe(false);

    // 禁用时 getOrDefault 会回退
    const def = registry.getOrDefault("general");
    expect(def.manifest.id).toBe("analytics");
  });

  it("支持 setEnabled 动态切换应用状态", () => {
    const registry = new AppRegistry({
      apps: [
        { id: "analytics", enabled: true },
        { id: "general", enabled: true },
      ],
    });

    expect(registry.list().map((a) => a.manifest.id)).toEqual([
      "analytics",
      "general",
    ]);

    registry.setEnabled("general", false);
    expect(registry.list().map((a) => a.manifest.id)).toEqual(["analytics"]);

    registry.setEnabled("general", true);
    expect(registry.list().map((a) => a.manifest.id)).toEqual([
      "analytics",
      "general",
    ]);
  });

  it("支持动态 register 外部新应用", () => {
    const registry = new AppRegistry({
      apps: [{ id: "analytics", enabled: true }],
    });

    const mockApp: AppPackageDefinition = {
      manifest: {
        id: "custom_app",
        name: "自定义应用",
        version: "1.0.0",
        description: "动态注入测试",
        icon: "Bot",
      },
      client: {
        welcomeMessage: "欢迎使用自定义应用",
        presetQueries: [],
      },
      server: {
        buildSystemPrompt: () => "custom prompt",
      },
    };

    registry.register(mockApp, { enabled: true });
    expect(registry.has("custom_app")).toBe(true);
    expect(registry.get("custom_app")?.manifest.name).toBe("自定义应用");
    expect(registry.list().map((a) => a.manifest.id)).toContain("custom_app");
  });

  it("当注册未知底层能力时仅 console.warn 警告，不中断注册", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new AppRegistry({ apps: [] });

    const appWithUnknownCap: AppPackageDefinition = {
      manifest: {
        id: "alien_app",
        name: "未知能力应用",
        version: "1.0.0",
        description: "未知能力测试",
        icon: "Bot",
      },
      client: {
        welcomeMessage: "Hi",
        presetQueries: [],
      },
      server: {
        requiredCapabilities: ["quantum_teleportation" as unknown as "datasources"],
        buildSystemPrompt: () => "prompt",
      },
    };

    registry.register(appWithUnknownCap);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("声明了平台未知的底层能力")
    );
    expect(registry.has("alien_app")).toBe(true);

    warnSpy.mockRestore();
  });

  it("get 只判注册态，getEnabled/isAppEnabled 才判启用态（执行路径唯一入口）", () => {
    const registry = new AppRegistry({
      apps: [
        { id: "analytics", enabled: true },
        { id: "general", enabled: false },
      ],
    });

    // 注册态：停用也能拿到（用于「是否存在」判断）
    expect(registry.get("general")).toBeDefined();
    expect(registry.has("general")).toBe(true);

    // 执行态：停用必须拿不到
    expect(registry.getEnabled("general")).toBeUndefined();
    expect(registry.isAppEnabled("general")).toBe(false);

    expect(registry.getEnabled("analytics")).toBeDefined();
    expect(registry.isAppEnabled("analytics")).toBe(true);
  });

  it("getEnabled 对未注册 id 返回 undefined", () => {
    const registry = new AppRegistry({ apps: [{ id: "analytics" }] });
    expect(registry.getEnabled("nope")).toBeUndefined();
  });

  it("unregister 同时清除注册项、启用态与顺序位（卸载后不得再被分发）", () => {
    const registry = new AppRegistry({
      apps: [
        { id: "analytics", enabled: true },
        { id: "general", enabled: true },
        { id: "design", enabled: true },
      ],
    });

    expect(registry.unregister("general")).toBe(true);

    expect(registry.has("general")).toBe(false);
    expect(registry.get("general")).toBeUndefined();
    expect(registry.isAppEnabled("general")).toBe(false);
    expect(registry.list().map((a) => a.manifest.id)).toEqual([
      "analytics",
      "design",
    ]);

    // 重复注销返回 false（幂等）
    expect(registry.unregister("general")).toBe(false);
  });

  it("initFromConfig 可重复调用（启动引导幂等），重置后状态与配置一致", () => {
    const registry = new AppRegistry({
      apps: [{ id: "analytics", enabled: true }],
    });
    registry.setEnabled("analytics", false);

    registry.initFromConfig({
      apps: [
        { id: "analytics", enabled: true },
        { id: "design", enabled: true },
      ],
    });

    expect(registry.list().map((a) => a.manifest.id)).toEqual([
      "analytics",
      "design",
    ]);
    expect(registry.isAppEnabled("analytics")).toBe(true);
  });

  it("全局单例按打包种子注册了三个内置应用（引导前的同步兜底）", () => {
    // 服务端启动引导会用磁盘配置覆盖；但客户端首屏与同步调用依赖这份种子，
    // 缺了它就会出现「首屏没有应用」这类只在真实运行时才暴露的问题。
    expect(appRegistry.get(DEFAULT_APP_ID)).toBeDefined();
    for (const id of ["analytics", "general", "design"]) {
      expect(appRegistry.has(id), id).toBe(true);
      expect(appRegistry.isAppEnabled(id), id).toBe(true);
    }
    expect(appRegistry.list().map((a) => a.manifest.id)).toEqual([
      "analytics",
      "general",
      "design",
    ]);
  });
});
