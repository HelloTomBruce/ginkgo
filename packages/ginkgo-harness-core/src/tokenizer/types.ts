export interface TokenizerEstimator {
  /**
   * 计算或估算文本对应的 token 数量
   */
  encode(text: string): number;
}

export const DEFAULT_TIKTOKEN_ENCODING = "cl100k_base";
