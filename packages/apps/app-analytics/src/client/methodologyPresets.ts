"use client";

import { builtinMethodCards } from "../methodology";
import type { AppPresetQuery } from "@ginkgolab/app-sdk";

/**
 * 推荐列表 resolver（AppClientContract.resolvePresetQueries 插槽实现）：
 * 侧栏「推荐」= 方法卡的 presetQuery。拉取 /api/methodology 的合并卡集
 * （内置 + data/methodology/*.json 用户卡）映射为平台推荐契约；
 * 请求失败回退内置卡兜底（纯数据包，无运行时依赖）。
 */
export async function resolveMethodologyPresets(): Promise<AppPresetQuery[]> {
  try {
    const res = await fetch("/api/methodology");
    if (res.ok) {
      const body: unknown = await res.json();
      const cards = (body as { cards?: unknown }).cards;
      if (Array.isArray(cards)) {
        const list: AppPresetQuery[] = [];
        for (const c of cards) {
          if (!c || typeof c !== "object") continue;
          const card = c as Record<string, unknown>;
          if (
            typeof card.id === "string" &&
            typeof card.name === "string" &&
            typeof card.presetQuery === "string" &&
            card.presetQuery.length > 0
          ) {
            list.push({ id: card.id, text: card.presetQuery, category: card.name });
          }
        }
        if (list.length > 0) return list;
      }
    }
  } catch {
    /* 静默：回退内置卡兜底 */
  }
  return builtinMethodCards
    .filter((c): c is typeof c & { presetQuery: string } => Boolean(c.presetQuery))
    .map((c) => ({ id: c.id, text: c.presetQuery, category: c.name }));
}
