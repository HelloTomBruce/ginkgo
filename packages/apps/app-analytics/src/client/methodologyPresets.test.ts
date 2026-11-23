// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { builtinMethodCards } from "../methodology";
import { resolveMethodologyPresets } from "./methodologyPresets";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("resolveMethodologyPresets（AppClientContract.resolvePresetQueries 插槽实现）", () => {
  it("接口失败时回退到内置卡的 presetQuery", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("offline"));
    const presets = await resolveMethodologyPresets();

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/methodology");
    expect(presets.length).toBe(
      builtinMethodCards.filter((c) => c.presetQuery).length
    );
    expect(presets[0]).toMatchObject({ id: "trend", category: expect.any(String) });
  });

  it("接口成功时返回合并卡集（含用户卡），无 presetQuery 的卡不进推荐", async () => {
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
    const presets = await resolveMethodologyPresets();

    expect(presets).toEqual([
      { id: "trend", text: "走势如何？", category: "趋势与同比环比" },
      { id: "my-card", text: "自定义提问？", category: "我的方法" },
    ]);
  });

  it("接口返回空卡集时回退内置卡（不渲染空推荐）", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ cards: [] }), { status: 200 })
    );
    const presets = await resolveMethodologyPresets();
    expect(presets.length).toBe(
      builtinMethodCards.filter((c) => c.presetQuery).length
    );
  });
});
