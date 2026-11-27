import {
  renderCardForPrompt,
  type ActiveSourceSummary,
  type DatasourceManager,
} from "@ginkgolab/datasources";

/** 全部启用源结构卡注入 prompt 的总量预算（与单卡 2KB 预算配套，快照测试守护） */
export const SCHEMA_DIGEST_TOTAL_BUDGET_BYTES = 8 * 1024;

/**
 * 组装启用源的结构卡摘要：逐源读卡（渲染职责在 datasources 包），
 * 依据用户提问相关度优先展开核心表，按总量预算降序纳入，超限的源省略并标注。
 * 读卡失败静默跳过（不阻塞分析）。返回摘要文本与因预算被省略的源数（供遥测告警）。
 */
export async function buildSchemaDigest(
  datasources: DatasourceManager,
  activeSources: ActiveSourceSummary[],
  queryHint?: string
): Promise<{ text?: string; omitted: number }> {
  if (activeSources.length === 0) return { omitted: 0 };
  const sections: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const s of activeSources) {
    try {
      const got = await datasources.getSchemaCard(s.id);
      if (!got) continue;
      const text = renderCardForPrompt(got.card, { queryHint });
      const bytes = Buffer.byteLength(text, "utf-8");
      if (used + bytes > SCHEMA_DIGEST_TOTAL_BUDGET_BYTES) {
        omitted++;
        continue;
      }
      sections.push(text);
      used += bytes;
    } catch {
      // 读卡失败不阻塞分析
    }
  }
  if (sections.length === 0) return { omitted };
  if (omitted > 0) {
    sections.push(`（另有 ${omitted} 个数据源的结构卡因总量预算省略，可用工具现场探查）`);
  }
  return { text: sections.join("\n\n"), omitted };
}

/** 提取对话历史中最后一条用户提问文本作为表画像召回提示词 */
export function extractLatestUserQuery(messages: unknown[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (m && m.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((p) =>
            typeof p === "object" && p && "text" in p ? String(p.text) : ""
          )
          .join(" ");
      }
    }
  }
  return undefined;
}
