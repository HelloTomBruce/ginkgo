import { describe, it, expect } from "vitest";
import { ModelCatalogRegistry, DEFAULT_CONTEXT_WINDOW } from "./registry";

describe("ModelCatalogRegistry", () => {
  it("默认匹配内置模型窗口", () => {
    const registry = new ModelCatalogRegistry();
    expect(registry.resolveContextWindow("gpt-4o")).toBe(128_000);
    expect(registry.resolveContextWindow("gpt-4.1-turbo")).toBe(1_000_000);
    expect(registry.resolveContextWindow("claude-3-7-sonnet")).toBe(200_000);
  });

  it("长前缀优先于短前缀", () => {
    const registry = new ModelCatalogRegistry({
      "gpt-4": 32_000,
      "gpt-4.1": 1_000_000,
      "gpt-4o": 128_000,
    });
    expect(registry.resolveContextWindow("gpt-4.1")).toBe(1_000_000);
    expect(registry.resolveContextWindow("gpt-4o-mini")).toBe(128_000);
    expect(registry.resolveContextWindow("gpt-4-0613")).toBe(32_000);
  });

  it("动态注册与覆盖", () => {
    const registry = new ModelCatalogRegistry();
    registry.register("custom-model", 512_000);
    expect(registry.resolveContextWindow("custom-model-v2")).toBe(512_000);
  });

  it("未命中模型回退到默认窗口", () => {
    const registry = new ModelCatalogRegistry();
    expect(registry.resolveContextWindow("completely-unknown-model")).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("客户端合法 hint 优先于查表", () => {
    const registry = new ModelCatalogRegistry();
    expect(registry.resolveContextWindow("gpt-4o", 64_000)).toBe(64_000);
    expect(registry.resolveContextWindow("gpt-4o", "32000")).toBe(32_000);
  });
});
