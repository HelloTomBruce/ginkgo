import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isReasoningModel,
  normalizeModel,
  getModelId,
  dedupeModels,
  ensureModelInList,
  isModelEnabled,
  getRecentModels,
  recordRecentModel,
  resolveContextWindow,
  ModelCatalogRegistry,
  findPreset,
  inferProviderByBaseURL,
  convertCatalog,
  mergePresets,
  createDefaultConfiguredProviders,
} from "./index";

describe("@ginkgo/models", () => {
  describe("模型标识与归一化", () => {
    it("normalizeModel 支持字符串与配置对象", () => {
      expect(normalizeModel("gpt-4o")).toEqual({ id: "gpt-4o" });
      expect(normalizeModel({ id: "gpt-4o", contextWindow: "128000" })).toEqual({
        id: "gpt-4o",
        contextWindow: "128000",
      });
    });

    it("getModelId 正确提取 ID", () => {
      expect(getModelId("deepseek-chat")).toBe("deepseek-chat");
      expect(getModelId({ id: "deepseek-reasoner" })).toBe("deepseek-reasoner");
    });
  });

  describe("推理思考模型判断 (isReasoningModel)", () => {
    it("按命名规则匹配已知推理模型", () => {
      expect(isReasoningModel("o1")).toBe(true);
      expect(isReasoningModel("o3-mini")).toBe(true);
      expect(isReasoningModel("deepseek-reasoner")).toBe(true);
      expect(isReasoningModel("deepseek-r1")).toBe(true);
      expect(isReasoningModel("deepseek-ai/DeepSeek-R1")).toBe(true);
      expect(isReasoningModel("qwq-32b")).toBe(true);
      expect(isReasoningModel("kimi-thinking-preview")).toBe(true);
    });

    it("非推理模型返回 false", () => {
      expect(isReasoningModel("gpt-4o")).toBe(false);
      expect(isReasoningModel("claude-sonnet-4-5")).toBe(false);
      expect(isReasoningModel("deepseek-chat")).toBe(false);
      expect(isReasoningModel(null)).toBe(false);
      expect(isReasoningModel("")).toBe(false);
    });

    it("支持显式配置覆盖", () => {
      expect(isReasoningModel("custom-model", { id: "custom-model", supportsReasoning: true })).toBe(true);
      expect(isReasoningModel("o3-mini", { id: "o3-mini", supportsReasoning: false })).toBe(false);
    });
  });

  describe("列表去重与追加 (dedupeModels & ensureModelInList)", () => {
    it("isModelEnabled 正确处理 enabled 标志", () => {
      expect(isModelEnabled("gpt-4o")).toBe(true);
      expect(isModelEnabled({ id: "gpt-4o" })).toBe(true);
      expect(isModelEnabled({ id: "gpt-4o", enabled: true })).toBe(true);
      expect(isModelEnabled({ id: "gpt-4o", enabled: false })).toBe(false);
      expect(isModelEnabled(null)).toBe(false);
    });

    it("去重并优先保留对象配置", () => {
      const input = [
        "gpt-4o",
        { id: "gpt-4o", contextWindow: "128000" },
        "deepseek-chat",
        "gpt-4o",
      ];
      const result = dedupeModels(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "gpt-4o", contextWindow: "128000" });
      expect(result[1]).toBe("deepseek-chat");
    });

    it("ensureModelInList 追加新模型并不重复现有模型", () => {
      const initial = ["gpt-4o"];
      const appended = ensureModelInList(initial, "claude-3-7-sonnet");
      expect(appended).toHaveLength(2);
      expect(ensureModelInList(appended, "gpt-4o")).toHaveLength(2);
    });
  });

  describe("上下文窗口解析 (resolveContextWindow)", () => {
    it("客户端 hint 优先并钳制在边界内", () => {
      expect(resolveContextWindow("gpt-4o", 64000)).toBe(64000);
      expect(resolveContextWindow("gpt-4o", 1000)).toBe(8192); // 最小值钳制
      expect(resolveContextWindow("gpt-4o", 10000000)).toBe(2000000); // 最大值钳制
    });

    it("无 hint 时命中模型匹配规则", () => {
      expect(resolveContextWindow("gpt-4o")).toBe(128000);
      expect(resolveContextWindow("gpt-4.1-mini")).toBe(1000000);
      expect(resolveContextWindow("claude-sonnet-4-5")).toBe(200000); // claude- 前缀 200k
      expect(resolveContextWindow("unknown-custom-model")).toBe(128000); // 缺省兜底
    });

    it("ModelCatalogRegistry 支持注册动态覆盖", () => {
      const registry = new ModelCatalogRegistry();
      registry.register("my-custom-prefix", 500000);
      expect(registry.resolveContextWindow("my-custom-prefix-v1")).toBe(500000);
    });
  });

  describe("预设与 Provider 推断", () => {
    it("findPreset 能找到内置预设", () => {
      expect(findPreset("deepseek")?.name).toBe("DeepSeek");
      expect(findPreset("anthropic")?.protocol).toBe("anthropic");
    });

    it("inferProviderByBaseURL 能通过 url 命中预设", () => {
      expect(inferProviderByBaseURL("https://api.deepseek.com/v1")).toBe("deepseek");
      expect(inferProviderByBaseURL("https://api.deepseek.com/v1/")).toBe("deepseek");
      expect(inferProviderByBaseURL("https://api.custom-host.com/v1")).toBe("custom");
    });

    it("createDefaultConfiguredProviders 包含常用预设", () => {
      const defaults = createDefaultConfiguredProviders();
      expect(defaults.some((p) => p.id === "deepseek")).toBe(true);
      expect(defaults.some((p) => p.id === "openai")).toBe(true);
    });

    it("convertCatalog 与 mergePresets 正确解析并合并外部目录", () => {
      const rawCatalog = {
        mockProvider: {
          id: "custom-mock",
          name: "Custom Mock",
          npm: "openai-compatible",
          api: "https://api.mock.com/v1",
          models: {
            "mock-model-1": { status: "active" },
            "mock-model-deprecated": { status: "deprecated" },
          },
        },
      };

      const converted = convertCatalog(rawCatalog);
      expect(converted).toHaveLength(1);
      expect(converted[0].id).toBe("custom-mock");
      expect(converted[0].models).toContain("mock-model-1");
      expect(converted[0].models).not.toContain("mock-model-deprecated");

      const merged = mergePresets(converted);
      expect(merged.some((p) => p.id === "custom-mock")).toBe(true);
      expect(merged.some((p) => p.id === "deepseek")).toBe(true);
    });
  });

  describe("最近使用模型 (Recent Models)", () => {
    const memoryStorage = new Map<string, string>();

    beforeEach(() => {
      memoryStorage.clear();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => memoryStorage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memoryStorage.set(k, v);
        },
        removeItem: (k: string) => {
          memoryStorage.delete(k);
        },
        clear: () => memoryStorage.clear(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("记录并读取最近使用，最多保留 5 个最新", () => {
      recordRecentModel("deepseek", "deepseek-chat");
      recordRecentModel("openai", "gpt-4o");
      recordRecentModel("anthropic", "claude-sonnet-4-5");

      const recents = getRecentModels();
      expect(recents).toHaveLength(3);
      expect(recents[0].model).toBe("claude-sonnet-4-5");
      expect(recents[1].model).toBe("gpt-4o");
      expect(recents[2].model).toBe("deepseek-chat");

      // 再次使用 deepseek-chat 会置顶
      recordRecentModel("deepseek", "deepseek-chat");
      const updated = getRecentModels();
      expect(updated).toHaveLength(3);
      expect(updated[0].model).toBe("deepseek-chat");
    });
  });
});
