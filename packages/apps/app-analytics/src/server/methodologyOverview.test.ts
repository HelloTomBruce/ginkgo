import { describe, it, expect } from "vitest";
import {
  buildMethodologyOverview,
  createAppMethodology,
} from "./methodologyLoader";
import { createMethodLibrary, builtinMethodCards } from "../methodology";

/** 真实注册表装配：内置卡 + 一张覆盖卡 + 一张新卡（经注入位供给，不读用户卡目录） */
function assembleFixture(
  overrides?: Partial<ReturnType<typeof createAppMethodology>>
) {
  const userCards = builtinMethodCards.slice(0, 1).map((c) => ({
    ...c,
    name: "趋势分析（定制版）",
  }));
  const { library } = createMethodLibrary({
    builtin: builtinMethodCards,
    custom: userCards,
  });
  return {
    library,
    skipped: [{ cardId: "broken.json", reason: "JSON 解析失败" }],
    userIds: new Set(userCards.map((c) => c.id)),
    ...overrides,
  };
}

describe("buildMethodologyOverview（GET /api/methodology 查看契约）", () => {
  it("返回合并卡集：id/名称/适用信号/步骤/图表配对 + source 标记，不含 executeGuidance", () => {
    const body = buildMethodologyOverview(assembleFixture);

    expect(body.cards).toHaveLength(builtinMethodCards.length);
    const trend = body.cards.find((c) => c.id === "trend")!;
    expect(trend).toMatchObject({
      name: "趋势分析（定制版）",
      source: "user",
    });
    expect((trend.steps as unknown[]).length).toBeGreaterThan(0);
    // executeGuidance 是 LLM prompt 内部件，不进查看契约
    expect((trend as Record<string, unknown>).executeGuidance).toBeUndefined();
    // 未被覆盖的内置卡 source=builtin
    expect(body.cards.find((c) => c.id === "pareto")!.source).toBe("builtin");
  });

  it("counts 统计内置/用户/覆盖数，skipped 透传坏卡清单", () => {
    const body = buildMethodologyOverview(assembleFixture);

    expect(body.counts).toEqual({
      builtin: builtinMethodCards.length,
      user: 1,
      overridden: 1,
    });
    expect(body.skipped).toEqual([
      { cardId: "broken.json", reason: "JSON 解析失败" },
    ]);
  });

  it("装配异常向上抛出（宿主薄壳负责 500 映射）", () => {
    expect(() =>
      buildMethodologyOverview(() => {
        throw new Error("disk boom");
      })
    ).toThrow("disk boom");
  });
});
