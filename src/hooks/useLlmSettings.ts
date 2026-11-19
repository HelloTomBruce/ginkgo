"use client";

import { useCallback, useMemo, useState } from "react";
import { ACCESS_TOKEN_STORAGE_KEY, authHeaders } from "@/lib/auth";
import {
  findPreset,
  inferProviderByBaseURL,
  type ConfiguredProvider,
  normalizeModel,
  getModelId,
  dedupeModels,
  ensureModelInList,
  createDefaultConfiguredProviders,
  PROVIDERS_STORAGE_KEY,
  ACTIVE_PROVIDER_STORAGE_KEY,
  ACTIVE_MODEL_STORAGE_KEY,
} from "@/lib/llmProviders";

const STORAGE_KEYS = {
  provider: "openui_llm_provider",
  apiKey: "openui_llm_api_key",
  baseURL: "openui_llm_base_url",
  model: "openui_llm_model",
  temperature: "openui_llm_temperature",
  reasoningEffort: "openui_llm_reasoning_effort",
  maxTokens: "openui_llm_max_tokens",
  maxSteps: "openui_llm_max_steps",
  contextWindow: "openui_llm_context_window",
  protocol: "openui_llm_protocol",
  fallbackModels: "openui_llm_fallback_models",
} as const;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = "0.2";
const DEFAULT_REASONING_EFFORT = "medium";
// 留空 → 服务端默认 16384（Anthropic 协议端点必须显式带 max_tokens，避免 finishReason=length 静默截断）
const DEFAULT_MAX_TOKENS = "";
// 留空 → 服务端默认 25 步（双重终态机制保证适时退出，最高100）
const DEFAULT_MAX_STEPS = "";
// 留空 → 根据模型自动推断（如 128k/1000k），支持用户显式指定（如 1024000）
const DEFAULT_CONTEXT_WINDOW = "";
const DEFAULT_PROTOCOL = "openai";
const DEFAULT_FALLBACK_MODELS = "";

function readStored(key: string, fallback: string): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key) || fallback;
  }
  return fallback;
}

function loadInitialProviders(): ConfiguredProvider[] {
  if (typeof window === "undefined") {
    return createDefaultConfiguredProviders();
  }

  const raw = localStorage.getItem(PROVIDERS_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p: ConfiguredProvider) => ({
          ...p,
          models: dedupeModels(p.models || []),
        }));
      }
    } catch {
      // ignore
    }
  }

  // 首次运行或老用户迁移：读取 legacy 键，与预设清单合并
  const defaults = createDefaultConfiguredProviders();
  const legacyKey = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
  const legacyBaseURL = localStorage.getItem(STORAGE_KEYS.baseURL);
  const legacyModel = localStorage.getItem(STORAGE_KEYS.model) || DEFAULT_MODEL;
  const legacyProtocol = (localStorage.getItem(STORAGE_KEYS.protocol) || DEFAULT_PROTOCOL) as "openai" | "anthropic";
  const legacyProviderId =
    localStorage.getItem(STORAGE_KEYS.provider) ||
    (legacyBaseURL ? inferProviderByBaseURL(legacyBaseURL) : "deepseek");

  if (legacyKey || legacyBaseURL) {
    const existingIndex = defaults.findIndex((p) => p.id === legacyProviderId);
    if (existingIndex >= 0) {
      defaults[existingIndex] = {
        ...defaults[existingIndex],
        apiKey: legacyKey,
        baseURL: legacyBaseURL || defaults[existingIndex].baseURL,
        protocol: legacyProtocol,
        models: ensureModelInList(defaults[existingIndex].models, legacyModel),
        defaultModel: legacyModel,
      };
    } else {
      defaults.unshift({
        id: legacyProviderId || "custom",
        name: legacyProviderId || "自定义",
        type: "custom",
        protocol: legacyProtocol,
        baseURL: legacyBaseURL || DEFAULT_BASE_URL,
        apiKey: legacyKey,
        models: [legacyModel],
        defaultModel: legacyModel,
        enabled: true,
      });
    }
  }

  try {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // ignore
  }

  return defaults;
}

/**
 * LLM / 多 Provider 配置状态管理：
 * - 维护已配置的提供商列表（支持多 provider、各 provider 下多模型）
 * - 维护当前会话活跃的 provider 与 model
 * - 兼容旧版 single-provider 接口与 localStorage 键
 */
export function useLlmSettings() {
  const [showSettings, setShowSettings] = useState(false);
  const [providers, setProviders] = useState<ConfiguredProvider[]>(() =>
    loadInitialProviders()
  );

  // 活跃 Provider ID：优先读取 ACTIVE_PROVIDER 键，次选 legacy 键，再选首个配置了 key 的 provider
  const [activeProviderId, setActiveProviderId] = useState<string>(() => {
    const storedActive = readStored(ACTIVE_PROVIDER_STORAGE_KEY, "");
    if (storedActive) return storedActive;
    const legacy = readStored(STORAGE_KEYS.provider, "");
    if (legacy) return legacy;
    const initialList = loadInitialProviders();
    const withKey = initialList.find((p) => p.apiKey.trim().length > 0);
    return withKey ? withKey.id : (initialList[0]?.id || "deepseek");
  });

  const activeProvider = useMemo(() => {
    return providers.find((p) => p.id === activeProviderId) || providers[0];
  }, [providers, activeProviderId]);

  // 活跃 Model：优先读取 ACTIVE_MODEL 键，次选 legacy model，再选 activeProvider.defaultModel 或首模型
  const [activeModel, setActiveModel] = useState<string>(() => {
    const stored = readStored(ACTIVE_MODEL_STORAGE_KEY, "");
    if (stored) return stored;
    const legacy = readStored(STORAGE_KEYS.model, "");
    if (legacy) return legacy;
    const initialList = loadInitialProviders();
    const active = initialList.find((p) => p.id === activeProviderId) || initialList[0];
    const firstModel = active?.models?.[0];
    return active?.defaultModel || (firstModel ? getModelId(firstModel) : DEFAULT_MODEL);
  });

  // 当前活跃模型的独立配置项（支持模型绑定的 contextWindow 与 maxTokens）
  const activeModelConfig = useMemo(() => {
    if (!activeProvider?.models) return undefined;
    const list = activeProvider.models.map(normalizeModel);
    return list.find((m) => m.id === activeModel) || list[0];
  }, [activeProvider, activeModel]);

  // 全局/通用参数
  const [accessToken, setAccessToken] = useState(() =>
    readStored(ACCESS_TOKEN_STORAGE_KEY, "")
  );
  const [temperature, setTemperature] = useState(() =>
    readStored(STORAGE_KEYS.temperature, DEFAULT_TEMPERATURE)
  );
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">(() => {
    const val = readStored(STORAGE_KEYS.reasoningEffort, DEFAULT_REASONING_EFFORT);
    return val === "low" || val === "high" ? val : "medium";
  });
  const [maxTokens, setMaxTokens] = useState(() =>
    readStored(STORAGE_KEYS.maxTokens, DEFAULT_MAX_TOKENS)
  );
  const [maxSteps, setMaxSteps] = useState(() =>
    readStored(STORAGE_KEYS.maxSteps, DEFAULT_MAX_STEPS)
  );
  const [contextWindow, setContextWindow] = useState(() =>
    readStored(STORAGE_KEYS.contextWindow, DEFAULT_CONTEXT_WINDOW)
  );
  const [fallbackModels, setFallbackModels] = useState(() =>
    readStored(STORAGE_KEYS.fallbackModels, DEFAULT_FALLBACK_MODELS)
  );

  // 保持单项状态受控（为了兼容现有单个 provider 字段或旧组件）
  const [providerId, setProviderId] = useState(() => activeProvider?.id || "deepseek");
  const [apiKey, setApiKey] = useState(() => activeProvider?.apiKey || "");
  const [baseURL, setBaseURL] = useState(() => activeProvider?.baseURL || DEFAULT_BASE_URL);
  const [protocol, setProtocol] = useState<"openai" | "anthropic">(
    () => activeProvider?.protocol || "openai"
  );
  const [model, setModel] = useState(() => activeModel);

  // 同步 activeProvider 变更到单项状态
  const syncFromProvider = useCallback((p?: ConfiguredProvider, targetModel?: string) => {
    if (!p) return;
    setProviderId(p.id);
    setApiKey(p.apiKey);
    setBaseURL(p.baseURL);
    setProtocol(p.protocol);
    const chosenModel =
      targetModel ||
      p.defaultModel ||
      (p.models[0] ? getModelId(p.models[0]) : DEFAULT_MODEL);
    setModel(chosenModel);
  }, []);

  /**
   * 会话中切换活跃模型：直接按 providerId 与 modelName 切换
   */
  const switchActiveModel = useCallback(
    (nextProviderId: string, nextModel: string) => {
      const targetProvider = providers.find((p) => p.id === nextProviderId);
      if (!targetProvider) return;

      setActiveProviderId(nextProviderId);
      setActiveModel(nextModel);
      syncFromProvider(targetProvider, nextModel);

      if (typeof window !== "undefined") {
        localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, nextProviderId);
        localStorage.setItem(ACTIVE_MODEL_STORAGE_KEY, nextModel);
        // 同步 legacy 键，保证外部单例或现有调用层无缝工作
        localStorage.setItem(STORAGE_KEYS.provider, nextProviderId);
        localStorage.setItem(STORAGE_KEYS.apiKey, targetProvider.apiKey);
        localStorage.setItem(STORAGE_KEYS.baseURL, targetProvider.baseURL);
        localStorage.setItem(STORAGE_KEYS.model, nextModel);
        localStorage.setItem(STORAGE_KEYS.protocol, targetProvider.protocol);
      }
    },
    [providers, syncFromProvider]
  );

  /**
   * 保存提供商（新增或更新已有）
   */
  const saveProvider = useCallback(
    (provider: ConfiguredProvider) => {
      const sanitizedProvider: ConfiguredProvider = {
        ...provider,
        models: dedupeModels(provider.models || []),
      };
      setProviders((prev) => {
        const index = prev.findIndex((p) => p.id === sanitizedProvider.id);
        let next: ConfiguredProvider[];
        if (index >= 0) {
          next = [...prev];
          next[index] = sanitizedProvider;
        } else {
          next = [...prev, sanitizedProvider];
        }
        if (typeof window !== "undefined") {
          localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });

      // 如果更新的是当前正在使用的 Provider，同步活跃状态
      if (provider.id === activeProviderId) {
        syncFromProvider(sanitizedProvider, activeModel);
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEYS.apiKey, sanitizedProvider.apiKey);
          localStorage.setItem(STORAGE_KEYS.baseURL, sanitizedProvider.baseURL);
          localStorage.setItem(STORAGE_KEYS.protocol, sanitizedProvider.protocol);
        }
      }
    },
    [activeProviderId, activeModel, syncFromProvider]
  );

  /**
   * 删除提供商
   */
  const deleteProvider = useCallback(
    (idToDelete: string) => {
      setProviders((prev) => {
        const next = prev.filter((p) => p.id !== idToDelete);
        if (typeof window !== "undefined") {
          localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });

      // 若删除了当前活跃 Provider，切换至首个
      if (idToDelete === activeProviderId) {
        const remaining = providers.filter((p) => p.id !== idToDelete);
        if (remaining.length > 0) {
          const nextActive = remaining[0];
          const nextModel =
            nextActive.defaultModel ||
            (nextActive.models[0] ? getModelId(nextActive.models[0]) : DEFAULT_MODEL);
          switchActiveModel(nextActive.id, nextModel);
        }
      }
    },
    [activeProviderId, providers, switchActiveModel]
  );

  /**
   * 预设切换旧逻辑保留（供旧兼容测试使用）
   */
  const applyProvider = useCallback(
    (id: string) => {
      setProviderId(id);
      const preset = findPreset(id);
      if (preset) {
        setBaseURL(preset.baseURL);
        setProtocol(preset.protocol);
        setModel(preset.defaultModel);
      }
    },
    []
  );

  const saveSettings = useCallback(() => {
    // 1. 同步当前编辑的值更新到对应的 provider
    setProviders((prev) => {
      const idx = prev.findIndex((p) => p.id === providerId);
      let next: ConfiguredProvider[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = {
          ...next[idx],
          apiKey,
          baseURL,
          protocol,
          models: ensureModelInList(next[idx].models, model),
          defaultModel: model,
        };
      } else {
        next = [
          ...prev,
          {
            id: providerId || "custom",
            name: providerId || "自定义",
            type: "custom",
            protocol,
            baseURL,
            apiKey,
            models: ensureModelInList([], model),
            defaultModel: model,
            enabled: true,
          },
        ];
      }
      if (typeof window !== "undefined") {
        localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });

    // 2. 持久化全局与活跃键
    if (typeof window !== "undefined") {
      localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, providerId);
      localStorage.setItem(ACTIVE_MODEL_STORAGE_KEY, model);
      localStorage.setItem(STORAGE_KEYS.provider, providerId);
      localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
      localStorage.setItem(STORAGE_KEYS.baseURL, baseURL);
      localStorage.setItem(STORAGE_KEYS.model, model);
      localStorage.setItem(STORAGE_KEYS.temperature, temperature);
      localStorage.setItem(STORAGE_KEYS.reasoningEffort, reasoningEffort);
      localStorage.setItem(STORAGE_KEYS.maxTokens, maxTokens);
      localStorage.setItem(STORAGE_KEYS.maxSteps, maxSteps);
      localStorage.setItem(STORAGE_KEYS.contextWindow, contextWindow);
      localStorage.setItem(STORAGE_KEYS.protocol, protocol);
      localStorage.setItem(STORAGE_KEYS.fallbackModels, fallbackModels);
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
    }
    setActiveProviderId(providerId);
    setActiveModel(model);
    setShowSettings(false);
  }, [
    providerId,
    apiKey,
    baseURL,
    protocol,
    model,
    temperature,
    reasoningEffort,
    maxTokens,
    maxSteps,
    contextWindow,
    fallbackModels,
    accessToken,
  ]);

  const activeContextWindow = activeModelConfig?.contextWindow || contextWindow;
  const activeMaxTokens = activeModelConfig?.maxTokens || maxTokens;

  const chatBody = useMemo(() => {
    const fallbackList = fallbackModels
      .split(/[,，\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      apiKey: (activeProvider?.apiKey || apiKey).trim() || undefined,
      baseURL: (activeProvider?.baseURL || baseURL).trim() || undefined,
      model: (activeModel || model).trim() || undefined,
      temperature: temperature.trim() || undefined,
      reasoningEffort,
      maxTokens: (activeModelConfig?.maxTokens || maxTokens).trim() || undefined,
      maxSteps: maxSteps.trim() || undefined,
      contextWindow: (activeModelConfig?.contextWindow || contextWindow).trim() || undefined,
      protocol: activeProvider?.protocol || protocol,
      resilience: fallbackList.length > 0 ? { fallbacks: fallbackList } : undefined,
    };
  }, [
    activeProvider?.apiKey,
    activeProvider?.baseURL,
    activeProvider?.protocol,
    activeModelConfig?.maxTokens,
    activeModelConfig?.contextWindow,
    activeModel,
    apiKey,
    baseURL,
    model,
    temperature,
    reasoningEffort,
    maxTokens,
    maxSteps,
    contextWindow,
    fallbackModels,
    protocol,
  ]);

  return {
    showSettings,
    setShowSettings,
    providers,
    setProviders,
    activeProviderId,
    activeModel,
    activeModelConfig,
    activeContextWindow,
    activeMaxTokens,
    activeProvider,
    switchActiveModel,
    saveProvider,
    deleteProvider,
    // 保持对旧接口的兼容
    providerId,
    applyProvider,
    apiKey: activeProvider?.apiKey || apiKey,
    setApiKey,
    baseURL: activeProvider?.baseURL || baseURL,
    setBaseURL,
    model: activeModel || model,
    setModel,
    accessToken,
    setAccessToken,
    temperature,
    setTemperature,
    reasoningEffort,
    setReasoningEffort,
    maxTokens: activeMaxTokens,
    setMaxTokens,
    maxSteps,
    setMaxSteps,
    contextWindow: activeContextWindow,
    setContextWindow,
    fallbackModels,
    setFallbackModels,
    protocol: activeProvider?.protocol || protocol,
    setProtocol,
    authHeaders,
    saveSettings,
    chatBody,
  };
}
