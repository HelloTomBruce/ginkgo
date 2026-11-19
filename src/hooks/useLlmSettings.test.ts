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
});
