import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { builtinMethodCards } from "@openui-analytics/methodology";
import { useMethodologyPresets } from "./useMethodologyPresets";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("useMethodologyPresets", () => {
  it("接口失败时回落到内置卡的 presetQuery", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMethodologyPresets());

    expect(result.current.length).toBe(builtinMethodCards.length);
    expect(result.current[0]).toMatchObject({ id: "trend" });
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/methodology")
    );
    // 失败后仍保持内置兜底
    expect(result.current.length).toBe(builtinMethodCards.length);
  });

  it("接口成功时用合并卡集（含用户卡）覆盖推荐列表", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          cards: [
            { id: "trend", name: "趋势与同比环比", presetQuery: "走势如何？" },
            { id: "my-card", name: "我的方法", presetQuery: "自定义提问？" },
            { id: "no-preset", name: "无预设卡" }, // 无 presetQuery 不进推荐
          ],
        }),
        { status: 200 }
      )
    );
    const { result } = renderHook(() => useMethodologyPresets());

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).toEqual([
      { id: "trend", name: "趋势与同比环比", query: "走势如何？" },
      { id: "my-card", name: "我的方法", query: "自定义提问？" },
    ]);
  });
});
