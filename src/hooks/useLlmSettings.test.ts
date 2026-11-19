import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLlmSettings } from "./useLlmSettings";

describe("useLlmSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("默认 fallbackModels 为空，chatBody 中 resilience 为 undefined", () => {
    const { result } = renderHook(() => useLlmSettings());

    expect(result.current.fallbackModels).toBe("");
    expect(result.current.chatBody.resilience).toBeUndefined();
  });

  it("设置 fallbackModels 并 saveSettings 后，localStorage 保存且 chatBody 包含 fallbacks", () => {
    const { result } = renderHook(() => useLlmSettings());

    act(() => {
      result.current.setFallbackModels("gpt-4o-mini, qwen-plus");
    });

    act(() => {
      result.current.saveSettings();
    });

    expect(localStorage.getItem("openui_llm_fallback_models")).toBe("gpt-4o-mini, qwen-plus");
    expect(result.current.chatBody.resilience).toEqual({
      fallbacks: ["gpt-4o-mini", "qwen-plus"],
    });
  });

  it("读取已保存的 fallbackModels 并正确解析", () => {
    localStorage.setItem("openui_llm_fallback_models", "claude-3-5-sonnet, deepseek-chat");

    const { result } = renderHook(() => useLlmSettings());

    expect(result.current.fallbackModels).toBe("claude-3-5-sonnet, deepseek-chat");
    expect(result.current.chatBody.resilience).toEqual({
      fallbacks: ["claude-3-5-sonnet", "deepseek-chat"],
    });
  });

  it("当添加模型（如 k3）并保存设置时，模型列表自动按 ID 去重，不出现两个重复模型", () => {
    const { result } = renderHook(() => useLlmSettings());

    const kimiProvider = result.current.providers.find((p) => p.id === "kimi-coding");
    expect(kimiProvider).toBeDefined();

    // 模拟添加单个模型 k3
    act(() => {
      result.current.saveProvider({
        ...kimiProvider!,
        models: [{ id: "k3", contextWindow: "128000" }],
        defaultModel: "k3",
      });
    });

    // 切换当前活跃为 kimi-coding 与 k3
    act(() => {
      result.current.switchActiveModel("kimi-coding", "k3");
    });

    // 点击保存设置
    act(() => {
      result.current.saveSettings();
    });

    // 重新获取 kimi-coding Provider
    const updatedKimi = result.current.providers.find((p) => p.id === "kimi-coding");
    expect(updatedKimi).toBeDefined();
    // 绝不出现两个 k3
    const k3Models = updatedKimi!.models.filter(
      (m) => (typeof m === "string" ? m : m.id) === "k3"
    );
    expect(k3Models).toHaveLength(1);
  });
});
