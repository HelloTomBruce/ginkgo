import fs from "node:fs";
import { DEFAULT_TIKTOKEN_ENCODING } from "./types";

/**
 * 依据模型名称解析适用的 Tiktoken 编码名称（最长前缀匹配）。
 * mappingOrPath 可直接传入 Record 映射字典，或文件绝对路径。
 */
export function resolveEncodingForModel(
  model: string,
  mappingOrPath?: Record<string, string> | string
): string {
  let table: Record<string, string> | undefined;

  if (typeof mappingOrPath === "object" && mappingOrPath !== null) {
    table = mappingOrPath;
  } else if (typeof mappingOrPath === "string") {
    try {
      table = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ mappingOrPath, "utf-8")
      ) as Record<string, string>;
    } catch {
      table = undefined;
    }
  }

  if (!table) {
    return DEFAULT_TIKTOKEN_ENCODING;
  }

  const lower = model.toLowerCase();
  let bestKey: string | undefined;

  for (const key of Object.keys(table)) {
    if (
      lower.startsWith(key.toLowerCase()) &&
      (bestKey === undefined || key.length > bestKey.length)
    ) {
      bestKey = key;
    }
  }

  if (bestKey !== undefined && typeof table[bestKey] === "string") {
    return table[bestKey];
  }

  return DEFAULT_TIKTOKEN_ENCODING;
}
