import { DEFAULT_TIKTOKEN_ENCODING, type TokenizerEstimator } from "./types";

export interface TiktokenEstimatorOptions {
  /** 未安装 js-tiktoken 时的自定义告警回调，缺省时 console.warn 一次 */
  onWarnMissing?: (error: unknown) => void;
}

let warnedMissing = false;
const encoderCache = new Map<string, { encode(text: string): number[] }>();

/**
 * 动态加载 js-tiktoken（peer optional）。
 * 安装后使用真实 BPE 编码，未安装回退 undefined，由调用方选择回退启发式估算。
 */
export async function createTiktokenEstimator(
  encoding: string = DEFAULT_TIKTOKEN_ENCODING,
  options?: TiktokenEstimatorOptions
): Promise<TokenizerEstimator | undefined> {
  try {
    const pkgName = "js-tiktoken";
    const mod = (await import(/* @vite-ignore */ pkgName)) as {
      getEncoding?: (encoding: string) => { encode(text: string): number[] };
    };
    if (typeof mod.getEncoding !== "function") {
      throw new Error("js-tiktoken 格式不匹配（缺少 getEncoding 方法）");
    }

    let encoder = encoderCache.get(encoding);
    if (!encoder) {
      encoder = mod.getEncoding(encoding);
      encoderCache.set(encoding, encoder);
    }

    return {
      encode: (text: string) => encoder!.encode(text).length,
    };
  } catch (error) {
    if (!warnedMissing) {
      warnedMissing = true;
      if (options?.onWarnMissing) {
        options.onWarnMissing(error);
      } else {
        console.warn(
          `[tokenizer] Optional peer dependency "js-tiktoken" is not available (${
            error instanceof Error ? error.message : String(error)
          }). Falling back to heuristic estimation.`
        );
      }
    }
    return undefined;
  }
}
