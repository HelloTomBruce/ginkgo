"use client";

import { useEffect, useState } from "react";
import { builtinMethodCards } from "@openui-analytics/methodology";

/**
 * 侧栏「推荐」列表的数据源：方法卡的 presetQuery。
 * 首帧用内置卡兜底（纯数据包，无运行时依赖），挂载后拉
 * /api/methodology 的合并卡集（内置 + 用户卡）覆盖——
 * 用户在 data/methodology/*.json 新增带 presetQuery 的卡即出现在推荐里。
 */
export interface PresetQuery {
  id: string;
  name: string;
  query: string;
}

const BUILTIN_PRESETS: PresetQuery[] = builtinMethodCards
  .filter((c): c is typeof c & { presetQuery: string } =>
    Boolean(c.presetQuery)
  )
  .map((c) => ({ id: c.id, name: c.name, query: c.presetQuery }));

export function useMethodologyPresets(): PresetQuery[] {
  const [presets, setPresets] = useState<PresetQuery[]>(BUILTIN_PRESETS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/methodology")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body || typeof body !== "object") return;
        const cards = (body as { cards?: unknown }).cards;
        if (!Array.isArray(cards)) return;
        const list: PresetQuery[] = [];
        for (const c of cards) {
          if (!c || typeof c !== "object") continue;
          const card = c as Record<string, unknown>;
          if (
            typeof card.id === "string" &&
            typeof card.name === "string" &&
            typeof card.presetQuery === "string" &&
            card.presetQuery.length > 0
          ) {
            list.push({ id: card.id, name: card.name, query: card.presetQuery });
          }
        }
        if (list.length > 0) setPresets(list);
      })
      .catch(() => {
        /* 静默：保留内置兜底 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return presets;
}
