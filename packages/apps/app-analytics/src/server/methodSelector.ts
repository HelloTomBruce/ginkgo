import {
  renderCardDetail,
  type MethodLibrary,
} from "@openui-analytics/methodology";

/**
 * execute 模式方法提取（WS-4 结构化交接的降级兜底）：从消息历史**最近一条 assistant 消息**（即待执行的
 * PlanReviewCard 规划）中匹配方法 id（词边界）或卡名（中文语境兜底），
 * 命中卡按需注入详情（≤2 张，与 plan 阶段「选 1~2 个方法」契约一致）。
 * 未命中返回 undefined（execute prompt 回落到无详情的增量约束）。
 */
export function buildMethodDetailsFromMessages(
  library: MethodLibrary,
  messages: unknown[]
): string | undefined {
  let lastAssistant: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (!m || m.role !== "assistant") continue;
    lastAssistant = typeof m.content === "string" ? m.content : undefined;
    break;
  }
  if (!lastAssistant) return undefined;

  const matched: string[] = [];
  for (const card of library.cards) {
    if (matched.length >= 2) break;
    const idRe = new RegExp(`\\b${card.id}\\b`, "i");
    if (idRe.test(lastAssistant) || lastAssistant.includes(card.name)) {
      matched.push(renderCardDetail(card));
    }
  }
  return matched.length > 0 ? matched.join("\n\n") : undefined;
}

/** 按 id 注入方法卡详情（WS-4 结构化主路径;≤2 张,与 plan 契约一致;未知 id 跳过） */
export function renderMethodDetailsByIds(
  library: MethodLibrary,
  ids: string[]
): string | undefined {
  const matched: string[] = [];
  for (const id of ids) {
    if (matched.length >= 2) break;
    const card = library.cards.find((c) => c.id === id);
    if (card) matched.push(renderCardDetail(card));
  }
  return matched.length > 0 ? matched.join("\n\n") : undefined;
}
