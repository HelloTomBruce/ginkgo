/**
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
   * 2. 最长前缀贪婪匹配
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
      if (lower.startsWith(prefix)) {
        if (!matchedPrefix || prefix.length > matchedPrefix.length) {
          matchedPrefix = prefix;
        }
      }
    }

    if (matchedPrefix) {
      return this.windows.get(matchedPrefix)!;
    }

    return DEFAULT_CONTEXT_WINDOW;
  }
}

/** 全局默认单例（向后兼容） */
export const defaultModelCatalog = new ModelCatalogRegistry();
