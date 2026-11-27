/**
 * @ginkgolab/models - 协议与核心类型契约
 * 平台级模型与 Provider 数据契约，零外部依赖，纯同构。
 */

export type LlmProtocol = "openai" | "anthropic";

export const CUSTOM_PROVIDER_ID = "custom";

/** 单个模型的高级绑定配置（窗口容量、最大输出 tokens、思考/推理支持） */
export interface ModelConfig {
  /** 模型 ID，如 gpt-4o, deepseek-chat */
  id: string;
  /** 可选展示名称 */
  name?: string;
  /** 上下文窗口容量（如 "128000"、"1000000"），留空按模型自动推断 */
  contextWindow?: string;
  /** 最大输出 tokens（如 "16384"、"32768"、"65536"），留空走服务端默认 */
  maxTokens?: string;
  /** 是否为深度思考 / 推理模型（勾选后在输入框支持选择 Reasoning Effort，自动锁定采样温度） */
  supportsReasoning?: boolean;
  /** 是否在前端快捷切换器中展示（缺省为 true） */
  enabled?: boolean;
}

export type ModelDefinition = string | ModelConfig;

export type ReasoningEffort = "low" | "medium" | "high";

export interface LlmProviderPreset {
  /** 稳定 id，持久化于 localStorage ginkgo_llm_provider */
  id: string;
  /** 展示名 */
  name: string;
  /** 所属厂商或分类分组 */
  group?: string;
  /** 接口协议：anthropic（/v1/messages）或 openai 兼容（/chat/completions） */
  protocol: LlmProtocol;
  /** 默认 baseURL（服务端会做 /v1 规范化） */
  baseURL: string;
  /** 默认模型 */
  defaultModel: string;
  /** 常用模型列表（下拉选项；含 defaultModel） */
  models: string[];
  /** API Key 获取提示（占位符/说明用） */
  keyHint: string;
}

/** 已配置的多 Provider 实体（支持多模型、自定义端点） */
export interface ConfiguredProvider {
  /** 唯一标识，如 deepseek, openai, custom-1 */
  id: string;
  /** 展示名称，如 DeepSeek, 火山引擎 */
  name: string;
  /** 内置预设或自定义 API */
  type: "builtin" | "custom";
  /** 对应内置预设 id */
  presetId?: string;
  /** 接口协议 */
  protocol: LlmProtocol;
  /** 接口地址 */
  baseURL: string;
  /** API 凭据 */
  apiKey: string;
  /** 当前 Provider 下配置的模型列表（支持字符串或带独立窗口/Tokens的结构体） */
  models: ModelDefinition[];
  /** 默认选中的模型 */
  defaultModel?: string;
  /** 是否启用 */
  enabled?: boolean;
  temperature?: string;
  maxTokens?: string;
  maxSteps?: string;
  contextWindow?: string;
}

export interface RecentModelItem {
  providerId: string;
  model: string;
  usedAt: number;
}

/** 本地存储 Key 常量 */
export const PROVIDERS_STORAGE_KEY = "ginkgo_llm_providers";
export const ACTIVE_PROVIDER_STORAGE_KEY = "ginkgo_llm_active_provider";
export const ACTIVE_MODEL_STORAGE_KEY = "ginkgo_llm_active_model";
export const RECENT_MODELS_STORAGE_KEY = "ginkgo_llm_recent_models";
export const CATALOG_CACHE_KEY = "ginkgo_llm_provider_catalog";
