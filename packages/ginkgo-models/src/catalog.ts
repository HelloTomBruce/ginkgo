/**
 * @ginkgolab/models - 模型目录、上下文计算与动态加载
 */

import { LLM_PROVIDER_PRESETS } from "./presets";
import {
  CATALOG_CACHE_KEY,
  CUSTOM_PROVIDER_ID,
  type LlmProviderPreset,
} from "./types";
import { getLocalStorage } from "./storage";

/**
 * 默认模型上下文窗口表（前缀匹配，长前缀优先；未命中回落缺省值）
 */
export const DEFAULT_MODEL_WINDOW_MAP: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4.1": 1_000_000,
  "gpt-5": 400_000,
  "o4-mini": 200_000,
  "o3": 200_000,
  "claude-": 200_000,
  "kimi": 262_144,
  "glm-5": 200_000,
  "glm-4": 128_000,
  "deepseek": 128_000,
  "qwen": 131_072,
  "gemini": 1_000_000,
};

export const CONTEXT_WINDOW_MIN = 8192;
export const CONTEXT_WINDOW_MAX = 2_000_000;
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * 模型元数据注册表接口
 */
export interface ModelCatalog {
  resolveContextWindow(model: string, clientHint?: unknown): number;
  register(prefix: string, contextWindow: number): void;
}

/**
 * 动态模型元数据注册中心（支持热注册、动态覆盖与前缀贪婪匹配）
 */
export class ModelCatalogRegistry implements ModelCatalog {
  private readonly windows = new Map<string, number>();

  constructor(initialMap: Record<string, number> = DEFAULT_MODEL_WINDOW_MAP) {
    for (const [prefix, win] of Object.entries(initialMap)) {
      this.windows.set(prefix.toLowerCase(), win);
    }
  }

  /**
   * 动态注册或覆盖特定模型前缀的上下文窗口大小
   */
  register(prefix: string, contextWindow: number): void {
    this.windows.set(prefix.toLowerCase(), contextWindow);
  }

  /**
   * 解析模型窗口：
   * 1. 客户端 hint 优先（钳制在 8k-2M）
   * 2. 最长匹配贪婪命中（startsWith 或 includes 子串均算命中，取最长者）——
   *    注意：较旧版 harness-core 内联实现仅 startsWith，此处是有意放宽，
   *    为覆盖 openai/gpt-4o-mini、deepseek-ai/DeepSeek-R1 等带路由前缀的模型 ID；
   *    代价是模型名恰好包含表中前缀子串时可能误命中（启发式场景可接受）
   * 3. 兜底默认值 DEFAULT_CONTEXT_WINDOW
   */
  resolveContextWindow(model: string, clientHint?: unknown): number {
    const hint = Number(clientHint);
    if (Number.isFinite(hint) && hint > 0) {
      return Math.min(
        Math.max(Math.round(hint), CONTEXT_WINDOW_MIN),
        CONTEXT_WINDOW_MAX
      );
    }

    const lower = model.toLowerCase();
    let matchedPrefix: string | undefined;

    for (const prefix of this.windows.keys()) {
      if (lower.startsWith(prefix) || lower.includes(prefix)) {
        if (!matchedPrefix || prefix.length > matchedPrefix.length) {
          matchedPrefix = prefix;
        }
      }
    }

    if (matchedPrefix) {
      return this.windows.get(matchedPrefix) ?? DEFAULT_CONTEXT_WINDOW;
    }

    return DEFAULT_CONTEXT_WINDOW;
  }
}

/** 全局默认单例 */
export const defaultModelCatalog = new ModelCatalogRegistry();

export function resolveContextWindow(model: string, clientHint?: unknown): number {
  return defaultModelCatalog.resolveContextWindow(model, clientHint);
}

// ---------------------------------------------------------------------------
// 动态目录（models.dev）：拉取全量 provider 目录，内置精选兜底
// ---------------------------------------------------------------------------

const CATALOG_URL = "https://models.dev/api.json";
/** 缓存有效期 24h：命中直接用，过期后台刷新，失败回退缓存/内置 */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
/** datalist 模型建议上限（超大列表截断，仅作提示用） */
const MODEL_SUGGESTION_CAP = 100;

/** 合并后的当前目录：内置精选优先（保留中文名/默认模型/Key 提示），目录补全模型并追加其余 provider */
let dynamicPresets: LlmProviderPreset[] | null = null;

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * models.dev api.json → LlmProviderPreset[]。
 * 只保留本应用 apiKey+baseURL 模式可接入的条目：
 * - npm 为 openai-compatible / openai / anthropic 系（排除 Bedrock/Azure/Vertex 等专有认证）
 * - 带静态 api baseURL（排除含 ${...} 模板变量的）
 */
export function convertCatalog(raw: unknown): LlmProviderPreset[] {
  if (!raw || typeof raw !== "object") return [];
  const presets: LlmProviderPreset[] = [];
  for (const p of Object.values(raw as Record<string, Record<string, unknown>>)) {
    const npm = typeof p.npm === "string" ? p.npm : "";
    const api = typeof p.api === "string" ? p.api : "";
    if (!/openai|anthropic/.test(npm)) continue;
    if (!api || api.includes("${")) continue;
    const models = Object.entries(
      (p.models as Record<string, { status?: string }>) ?? {}
    )
      .filter(([, m]) => m && m.status !== "deprecated")
      .map(([id]) => id)
      .slice(0, MODEL_SUGGESTION_CAP);
    presets.push({
      id: String(p.id ?? ""),
      name: String(p.name ?? p.id ?? ""),
      protocol: npm.includes("anthropic") ? "anthropic" : "openai",
      baseURL: api,
      defaultModel: models[0] ?? "",
      models,
      keyHint: "在 Provider 官网获取 API Key",
    });
  }
  return presets.filter((p) => p.id && p.baseURL);
}

/** 内置精选 + 动态目录按 baseURL 去重合并：内置条目保留元信息，模型取并集 */
export function mergePresets(catalog: LlmProviderPreset[]): LlmProviderPreset[] {
  const merged = LLM_PROVIDER_PRESETS.map((builtin) => {
    const hit = catalog.find(
      (c) => normalizeBase(c.baseURL) === normalizeBase(builtin.baseURL)
    );
    if (!hit) return builtin;
    const models = [
      ...new Set([builtin.defaultModel, ...builtin.models, ...hit.models]),
    ];
    return { ...builtin, models };
  });
  const builtinBaseUrls = new Set(
    LLM_PROVIDER_PRESETS.map((p) => normalizeBase(p.baseURL))
  );
  const rest = catalog
    .filter((c) => !builtinBaseUrls.has(normalizeBase(c.baseURL)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...merged, ...rest];
}

/** 读取本地缓存目录（未过期且结构合法才返回，存的是转换后的精简目录） */
function readCatalogCache(): LlmProviderPreset[] | null {
  try {
    const storage = getLocalStorage();
    if (!storage) return null;
    const raw = storage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; catalog: LlmProviderPreset[] };
    if (Date.now() - parsed.fetchedAt > CATALOG_TTL_MS) return null;
    const catalog = parsed.catalog;
    if (!Array.isArray(catalog) || !catalog.length) return null;
    if (!catalog.every((p) => p && p.id && p.baseURL)) return null;
    return catalog;
  } catch {
    return null;
  }
}

/**
 * 确保 Provider 目录就绪：缓存命中→立即返回并后台刷新；否则拉取 models.dev。
 * 任何失败静默回退内置精选（目录是纯体验层，不阻塞配置）。
 */
export async function ensureProviderCatalog(): Promise<LlmProviderPreset[]> {
  if (dynamicPresets) return dynamicPresets;
  const cached = readCatalogCache();
  if (cached) {
    dynamicPresets = mergePresets(cached);
    // 缓存后台静默刷新，不等待（refreshCatalog 内部全量 catch，永不 reject）
    void refreshCatalog();
    return dynamicPresets;
  }
  return refreshCatalog();
}

async function refreshCatalog(): Promise<LlmProviderPreset[]> {
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`catalog http ${res.status}`);
    const raw = await res.json();
    const catalog = convertCatalog(raw);
    if (!catalog.length) throw new Error("catalog empty");
    dynamicPresets = mergePresets(catalog);
    try {
      const storage = getLocalStorage();
      if (storage) {
        storage.setItem(
          CATALOG_CACHE_KEY,
          JSON.stringify({ fetchedAt: Date.now(), catalog })
        );
      }
    } catch {
      /* 缓存写入失败（如配额）不影响目录使用 */
    }
    return dynamicPresets;
  } catch {
    // 拉取失败：保持缓存/内置
    return (dynamicPresets ??= mergePresets([]));
  }
}

/** 当前可用目录（动态未就绪时为内置精选） */
export function currentPresets(): LlmProviderPreset[] {
  return dynamicPresets ?? LLM_PROVIDER_PRESETS;
}

/** 全部下拉选项（含「自定义」收尾） */
export function providerOptions(): { id: string; name: string }[] {
  return [
    ...currentPresets().map(({ id, name }) => ({ id, name })),
    { id: CUSTOM_PROVIDER_ID, name: "自定义" },
  ];
}

export function findPreset(id: string): LlmProviderPreset | undefined {
  return currentPresets().find((p) => p.id === id);
}

/** 按已存 baseURL 反推 Provider（老用户迁移）：去尾斜杠精确匹配，匹配不到返回 custom */
export function inferProviderByBaseURL(baseURL: string): string {
  const normalized = normalizeBase(baseURL);
  if (!normalized) return "openai";
  const hit = currentPresets().find(
    (p) => normalizeBase(p.baseURL) === normalized
  );
  return hit ? hit.id : CUSTOM_PROVIDER_ID;
}
