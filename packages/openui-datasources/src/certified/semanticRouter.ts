import type { CertifiedQueryStore } from "./certifiedStore";
import type { CertifiedQueryMatch, MatchConfidence } from "./types";

/**
 * 简易词元提取器：提取中文分词/多词与英文单词（统一小写）
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase();
  // 提取英文单词/数字和中文字词
  const tokens = new Set<string>();

  // 1. 英文与数字单词
  const words = normalized.match(/[a-z0-9_-]+/g) || [];
  for (const w of words) {
    if (w.length >= 2) tokens.add(w);
  }

  // 2. 中文字段/常见二字/三字片段
  const han = normalized.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of han) {
    tokens.add(seg);
    if (seg.length > 2) {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.add(seg.substring(i, i + 2));
      }
    }
  }

  return Array.from(tokens);
}

/**
 * 语义与意图路由：为用户提问匹配最适用的 Certified Queries 认证口径
 */
export function matchCertifiedQueries(
  userQuery: string,
  activeSourceIds: string[] = [],
  store: CertifiedQueryStore,
  limit = 3
): CertifiedQueryMatch[] {
  const userTokens = tokenizeText(userQuery);
  if (userTokens.length === 0) return [];

  // 获取所有当前启用的数据源关联的认证查询
  const candidates = store.list().filter((q) => {
    if (q.sourceId === "*") return true;
    if (activeSourceIds.length === 0) return true;
    return activeSourceIds.includes(q.sourceId);
  });

  const matches: CertifiedQueryMatch[] = [];

  for (const candidate of candidates) {
    let score = 0;
    const matchedTerms = new Set<string>();

    const titleTokens = tokenizeText(candidate.title);
    const tagTokens = candidate.tags.flatMap(tokenizeText);
    const descTokens = tokenizeText(candidate.description + " " + (candidate.businessMetricFormula || ""));

    for (const ut of userTokens) {
      // 1. 标签精准命中（高权重：3.0）
      if (tagTokens.includes(ut)) {
        score += 3.0;
        matchedTerms.add(ut);
      }
      // 2. 标题命中（高权重：2.5）
      else if (titleTokens.includes(ut)) {
        score += 2.5;
        matchedTerms.add(ut);
      }
      // 3. 描述与计算公式命中（中权重：1.0）
      else if (descTokens.includes(ut)) {
        score += 1.0;
        matchedTerms.add(ut);
      }
    }

    if (matchedTerms.size > 0) {
      // 评分基准：结合命中词数与候选特征权重（命中核心标签和标题代表极高相关度）
      const candidateKeyWeight = Math.min(12, titleTokens.length * 2.0 + tagTokens.length * 2.5);
      const normalizedScore = Math.min(
        1.0,
        Math.round((score / Math.max(4.0, candidateKeyWeight * 0.6)) * 100) / 100
      );

      // 置信度分档对齐 RFC §2.2.2 三档策略：
      // ≥0.85 exact（强约束绑定）/ 0.6–0.85 high（Few-Shot 参考）/ 其余仅记录不注入
      let confidence: MatchConfidence = "low";
      if (normalizedScore >= 0.85) {
        confidence = "exact";
      } else if (normalizedScore >= 0.6) {
        confidence = "high";
      } else if (normalizedScore >= 0.35) {
        confidence = "medium";
      }

      matches.push({
        query: candidate,
        score: normalizedScore,
        confidence,
        matchedTerms: Array.from(matchedTerms),
      });
    }
  }

  // 按得分由高到低降序
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}
