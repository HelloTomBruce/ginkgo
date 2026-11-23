import type { TokenizerEstimator } from "./types";

const CJK_RE = /[一-鿿㐀-䶿䶿豈-﫿぀-ヿ가-힯]/g;

/**
 * 文本 token 启发式估算：
 * CJK 字符约 1.5 字符/token，其余（ASCII/西文）约 4 字符/token，
 * 乘以 1.1 的安全余量以防止低估。
 */
export function estimateTextTokensHeuristic(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) ?? []).length;
  return Math.ceil((cjk / 1.5 + (text.length - cjk) / 4) * 1.1);
}

/**
 * 基于 CJK + ASCII 启发式比率的内置轻量 Tokenizer
 */
export class HeuristicTokenizer implements TokenizerEstimator {
  encode(text: string): number {
    return estimateTextTokensHeuristic(text);
  }
}
