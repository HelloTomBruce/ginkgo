/**
 * 计量精化（WS-12）：可注入真实 tokenizer 的接缝。
 *
 * - 缺省 = context.ts 的 CJK 启发式估算，行为不变
 * - createTiktokenEstimator：peer optional 动态 import("js-tiktoken")——装上就用、
 *   没装回退启发式（warn 一次）
 * - 只影响 projectMessages 的预判定；usage.promptTokens 实测锚点仍是最高优先级
 *   （锚点机制不动，tokenizer 只让首轮/锚点失效后更准）
 * - 模型 → encoding 映射走 config/model-tokenizer.json（用户维护，零硬编码），
 *   未命中缺省 cl100k_base 近似
 */

export interface TokenizerEstimator {
  /** 文本 → token 数（非 token 数组，投影判定只要计数） */
  encode(text: string): number;
}

import fs from "node:fs";

const ENCODING_DEFAULT = "cl100k_base";

/** js-tiktoken 未安装只 warn 一次（多请求不刷屏） */
let warnedMissing = false;

/** encoding → Tiktoken 实例缓存（构建有成本，跨请求复用） */
const encoderCache = new Map<string, unknown>();

export async function createTiktokenEstimator(
  encoding: string = ENCODING_DEFAULT
): Promise<TokenizerEstimator | undefined> {
  try {
    // peer optional：未安装时此 import 失败 → 回退启发式
    const mod = (await import("js-tiktoken")) as {
      getEncoding?: (encoding: string) => { encode(text: string): number[] };
    };
    if (typeof mod.getEncoding !== "function") {
      throw new Error("js-tiktoken 形状不符（缺少 getEncoding）");
    }
    let encoder = encoderCache.get(encoding) as
      | { encode(text: string): number[] }
      | undefined;
    if (!encoder) {
      encoder = mod.getEncoding(encoding);
      encoderCache.set(encoding, encoder);
    }
    return { encode: (text: string) => encoder.encode(text).length };
  } catch (error) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(
        `[tokenizer] LLM_TOKENIZER=tiktoken 需要 js-tiktoken，但未安装（${
          error instanceof Error ? error.message : String(error)
        }）；回退 CJK 启发式估算。安装：\`pnpm add js-tiktoken\``
      );
    }
    return undefined;
  }
}

// ========== 模型 → encoding 映射（config/model-tokenizer.json，mtime 热加载） ==========

const TOKENIZER_CONFIG_DEFAULT = `${process.cwd()}/config/model-tokenizer.json`;

export function resolveEncodingForModel(
  model: string,
  configPath: string = TOKENIZER_CONFIG_DEFAULT
): string {
  try {
    // 每次读盘 + mtime 对比成本可忽略（仅 LLM_TOKENIZER=tiktoken 时调用）
    const table = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ configPath, "utf-8")
    ) as Record<string, string>;
    const lower = model.toLowerCase();
    let best: string | undefined;
    for (const key of Object.keys(table)) {
      if (lower.startsWith(key.toLowerCase()) && (best === undefined || key.length > best.length)) {
        best = key;
      }
    }
    if (best !== undefined && typeof table[best] === "string") return table[best];
  } catch {
    // 文件缺失/坏 JSON：缺省 encoding
  }
  return ENCODING_DEFAULT;
}
