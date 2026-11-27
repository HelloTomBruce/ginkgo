/**
 * @ginkgolab/models - 纯工具函数
 */

import {
  type ModelConfig,
  type ModelDefinition,
  type RecentModelItem,
  RECENT_MODELS_STORAGE_KEY,
} from "./types";
import { getLocalStorage } from "./storage";

export function normalizeModel(m: ModelDefinition): ModelConfig {
  return typeof m === "string" ? { id: m } : m;
}

export function getModelId(m: ModelDefinition): string {
  return typeof m === "string" ? m : m.id;
}

/**
 * 判断指定模型是否为深度思考 / 推理模型（如 o1, o3-mini, deepseek-reasoner, QwQ 等）
 * 支持通过 ModelConfig.supportsReasoning 显式指定，未显式指定时按模型 ID 规则智能推断
 *
 * Claude 3.7+ / 4 系（sonnet-4、opus-4、haiku-4、claude-3-7）支持 Extended Thinking 混合推理，
 * 视为推理模型（anthropic 协议下映射 thinking budget；温度锁定为 thinking 模式的协议要求）。
 * 3.5 及更早的 claude 不支持 extended thinking，不在此列。
 */
export function isReasoningModel(
  model: string | ModelConfig | null | undefined,
  config?: ModelConfig | null
): boolean {
  if (config && typeof config.supportsReasoning === "boolean") {
    return config.supportsReasoning;
  }
  if (typeof model === "object" && model !== null) {
    if (typeof model.supportsReasoning === "boolean") {
      return model.supportsReasoning;
    }
    return isReasoningModel(model.id);
  }
  if (!model) return false;
  const lower = model.toLowerCase();
  return (
    /^o[1-9](-|$)/.test(lower) ||
    lower.includes("reasoner") ||
    lower.includes("-r1") ||
    lower.endsWith("/r1") ||
    lower.includes("qwq") ||
    lower.includes("thinking") ||
    lower.includes("claude-3-7") ||
    lower.includes("claude-3.7") ||
    lower.includes("claude-sonnet-4") ||
    lower.includes("claude-opus-4") ||
    lower.includes("claude-haiku-4") ||
    lower.includes("claude-4")
  );
}

/**
 * 健壮的模型列表去重函数：
 * - 统一按 Model ID 去重，防止同一模型因 string/object 混合存储导致界面出现多个相同条目
 * - 当同时存在纯字符串与带参数的对象配置时，优先保留更丰富的对象配置
 * - 保持先出现的相对顺序
 */
export function dedupeModels(list: (ModelDefinition | undefined | null)[]): ModelDefinition[] {
  const map = new Map<string, ModelDefinition>();
  for (const item of list) {
    if (!item) continue;
    const id = getModelId(item).trim();
    if (!id) continue;
    const existing = map.get(id);
    if (!existing) {
      map.set(id, item);
    } else if (typeof existing === "string" && typeof item === "object") {
      map.set(id, item);
    }
  }
  return Array.from(map.values());
}

/**
 * 确保某个模型在列表中，若已存在则直接返回去重后的列表，若不存在则追加
 */
export function ensureModelInList(
  list: (ModelDefinition | undefined | null)[],
  targetModel: string
): ModelDefinition[] {
  const trimmed = targetModel.trim();
  if (!trimmed) return dedupeModels(list);
  const exists = list.some((m) => m && getModelId(m) === trimmed);
  if (exists) {
    return dedupeModels(list);
  }
  return dedupeModels([...list, trimmed]);
}

/** 判断模型是否在快捷选择器中启用（缺省为 true） */
export function isModelEnabled(m: ModelDefinition | null | undefined): boolean {
  if (!m) return false;
  if (typeof m === "string") return true;
  return m.enabled !== false;
}

/** 读取最近使用的模型列表 */
export function getRecentModels(): RecentModelItem[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is RecentModelItem =>
          item &&
          typeof item.providerId === "string" &&
          typeof item.model === "string"
      );
    }
  } catch {
    // ignore
  }
  return [];
}

/** 记录并持久化最近使用的模型（最多保留 5 个） */
export function recordRecentModel(
  providerId: string,
  model: string
): RecentModelItem[] {
  const storage = getLocalStorage();
  if (!storage || !providerId || !model) return [];
  try {
    const current = getRecentModels();
    const filtered = current.filter(
      (item) => !(item.providerId === providerId && item.model === model)
    );
    const updated: RecentModelItem[] = [
      { providerId, model, usedAt: Date.now() },
      ...filtered,
    ].slice(0, 5);
    storage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

