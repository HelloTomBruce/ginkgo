"use client";

import React, { useState } from "react";
import {
  X,
  Sliders,
  Key,
  Globe,
  Bot,
  Database,
  ChevronDown,
  Plus,
  RefreshCw,
  Puzzle,
  Zap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DatasourceSettings } from "./datasources/DatasourceSettings";
import { McpSettings } from "./mcp/McpSettings";
import { EngineSettings } from "./engine/EngineSettings";
import { GovernanceSettings } from "./governance/GovernanceSettings";
import {
  CUSTOM_PROVIDER_ID,
  LLM_PROVIDER_PRESETS,
  type ConfiguredProvider,
  type LlmProtocol,
  type ModelDefinition,
  type ModelConfig,
  type ReasoningEffort,
  isReasoningModel,
  findPreset,
  getModelId,
  normalizeModel,
  dedupeModels,
} from "@/lib/llmProviders";
import { useProviderCatalog } from "@/hooks/useProviderCatalog";

export interface SettingsModalProps {
  /** Provider 预设 id（llmProviders.ts），custom = 自由输入；缺省视为 custom */
  providerId?: string;
  apiKey: string;
  baseURL: string;
  model: string;
  accessToken: string;
  temperature: string;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (v: ReasoningEffort) => void;
  /** 最大输出 tokens（1024–65536），留空走服务端默认；Anthropic 端点必填 max_tokens */
  maxTokens: string;
  /** 最大步数上限（1–100），留空走服务端默认 25 步（双重终态防死循环熔断） */
  maxSteps?: string;
  /** 上下文窗口容量（8192–2000000），留空根据模型自动推断 */
  contextWindow?: string;
  /** 备选降级模型列表（逗号分隔），主模型不可用时自动按序回退 */
  fallbackModels?: string;
  /** 接口协议：openai 兼容（/chat/completions）或 anthropic（/v1/messages，如 Kimi Coding） */
  protocol: "openai" | "anthropic";
  onProviderChange: (v: string) => void;
  onApiKeyChange: (v: string) => void;
  onBaseURLChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onAccessTokenChange: (v: string) => void;
  onTemperatureChange: (v: string) => void;
  onMaxTokensChange: (v: string) => void;
  onMaxStepsChange?: (v: string) => void;
  onContextWindowChange?: (v: string) => void;
  onFallbackModelsChange?: (v: string) => void;
  onProtocolChange: (v: "openai" | "anthropic") => void;
  onSave: () => void;
  onClose: () => void;

  // 多 Provider 增强支持
  providers?: ConfiguredProvider[];
  activeProviderId?: string;
  activeModel?: string;
  onSaveProvider?: (provider: ConfiguredProvider) => void;
  onDeleteProvider?: (id: string) => void;
  onSwitchActiveModel?: (providerId: string, model: string) => void;
}

type SettingsTab = "model" | "datasources" | "mcp" | "engine" | "governance";

const SETTINGS_TABS: {
  id: SettingsTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "model", label: "模型配置", Icon: Bot },
  { id: "datasources", label: "数据源", Icon: Database },
  { id: "mcp", label: "MCP 扩展", Icon: Puzzle },
  { id: "engine", label: "引擎调度", Icon: Zap },
  { id: "governance", label: "治理观测", Icon: ShieldCheck },
];

/** 协议 + Base URL 字段 */
function EndpointFields({
  protocol,
  baseURL,
  onProtocolChange,
  onBaseURLChange,
}: {
  protocol: "openai" | "anthropic";
  baseURL: string;
  onProtocolChange: (v: "openai" | "anthropic") => void;
  onBaseURLChange: (v: string) => void;
}) {
  return (
    <>
      <fieldset>
        <legend className="block text-muted-foreground mb-1 font-medium flex items-center gap-1">
          <Sliders className="w-3.5 h-3.5" />
          <span>接口协议</span>
        </legend>
        <RadioGroup
          value={protocol}
          onValueChange={(v) => onProtocolChange(v as "openai" | "anthropic")}
          className="flex gap-4"
          aria-label="接口协议"
        >
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <RadioGroupItem value="openai" />
            <span>OpenAI 兼容</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <RadioGroupItem value="anthropic" />
            <span>Anthropic</span>
          </label>
        </RadioGroup>
      </fieldset>

      <div>
        <label
          htmlFor="settings-base-url"
          className="block text-muted-foreground mb-1 font-medium flex items-center gap-1"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Base URL</span>
        </label>
        <input
          id="settings-base-url"
          type="text"
          value={baseURL}
          onChange={(e) => onBaseURLChange(e.target.value)}
          placeholder={
            protocol === "anthropic"
              ? "https://api.kimi.com/coding"
              : "https://api.openai.com/v1"
          }
          className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono"
        />
      </div>
    </>
  );
}

/** 动态模型目录管理器（支持模型绑定的上下文窗口容量与最大输出 Tokens） */
function ModelCatalogEditor({
  models,
  onModelsChange,
  baseURL,
  apiKey,
  protocol,
  presetId,
}: {
  models: ModelDefinition[];
  onModelsChange: (models: ModelDefinition[]) => void;
  baseURL: string;
  apiKey: string;
  protocol: "openai" | "anthropic";
  presetId?: string;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [modelInputId, setModelInputId] = useState("");
  const [modelInputCtx, setModelInputCtx] = useState("");
  const [modelInputMaxTokens, setModelInputMaxTokens] = useState("");

  const [fetching, setFetching] = useState(false);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);

  const handleStartAdd = () => {
    setIsAdding(true);
    setEditingIndex(null);
    setModelInputId("");
    setModelInputCtx("");
    setModelInputMaxTokens("");
  };

  const handleStartEdit = (index: number) => {
    const item = normalizeModel(models[index]);
    setIsAdding(false);
    setEditingIndex(index);
    setModelInputId(item.id);
    setModelInputCtx(item.contextWindow || "");
    setModelInputMaxTokens(item.maxTokens || "");
  };

  const handleCancelEdit = () => {
    setIsAdding(false);
    setEditingIndex(null);
    setModelInputId("");
    setModelInputCtx("");
    setModelInputMaxTokens("");
  };

  const handleSaveModelItem = () => {
    const trimmedId = modelInputId.trim();
    if (!trimmedId) return;

    const newConfig: ModelConfig = {
      id: trimmedId,
      ...(modelInputCtx.trim() ? { contextWindow: modelInputCtx.trim() } : {}),
      ...(modelInputMaxTokens.trim() ? { maxTokens: modelInputMaxTokens.trim() } : {}),
    };

    if (editingIndex !== null) {
      const next = [...models];
      next[editingIndex] = newConfig;
      onModelsChange(dedupeModels(next));
    } else {
      const existingIdx = models.findIndex((m) => getModelId(m) === trimmedId);
      if (existingIdx >= 0) {
        const next = [...models];
        next[existingIdx] = newConfig;
        onModelsChange(dedupeModels(next));
      } else {
        onModelsChange(dedupeModels([...models, newConfig]));
      }
    }

    handleCancelEdit();
  };

  const handleRemoveModel = (modelIdToRemove: string) => {
    onModelsChange(models.filter((m) => getModelId(m) !== modelIdToRemove));
    if (editingIndex !== null) {
      handleCancelEdit();
    }
  };

  const handleFetchModels = async () => {
    if (!baseURL.trim()) {
      setFetchNotice("请先填写有效的 API 地址");
      return;
    }
    setFetching(true);
    setFetchNotice(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseURL, apiKey, protocol, presetId }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.models)) {
        if (data.models.length === 0) {
          setFetchNotice("未从接口获取到模型，已保持现有配置");
        } else {
          // 合并现有与拉取到的模型，保留现有已配置的上下文与 tokens
          const existingIds = new Set(models.map(getModelId));
          const nextList: ModelDefinition[] = [...models];
          for (const item of data.models) {
            const remoteId = typeof item === "string" ? item : item.id;
            if (!existingIds.has(remoteId)) {
              nextList.push({ id: remoteId });
              existingIds.add(remoteId);
            }
          }
          onModelsChange(nextList);
          setFetchNotice(data.notice || `成功获取 ${data.models.length} 个可用模型`);
        }
      } else {
        setFetchNotice(data.error || "获取模型列表失败，请核对凭证与地址");
      }
    } catch {
      setFetchNotice("网络请求失败，请稍后重试");
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-muted-foreground font-medium text-xs flex items-center gap-1">
          <Bot className="w-3.5 h-3.5" />
          <span>模型目录</span>
        </label>
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={fetching}
          className="text-xs text-info-fg hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} />
          <span>{fetching ? "获取中..." : "获取可用模型"}</span>
        </button>
      </div>

      {fetchNotice && (
        <div className="text-[11px] px-2.5 py-1 rounded-md bg-info-soft text-info-fg-strong border border-info-border">
          {fetchNotice}
        </div>
      )}

      {models.length === 0 ? (
        <div className="p-3 rounded-lg border border-dashed border-border text-center text-foreground-faint text-xs">
          模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。
        </div>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
          {models.map((rawModel, idx) => {
            const m = normalizeModel(rawModel);
            const isCurrentEditing = editingIndex === idx;

            return (
              <div
                key={`${m.id}-${idx}`}
                className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${
                  isCurrentEditing
                    ? "border-info-border bg-info-soft/30"
                    : "border-border bg-card hover:border-border-strong"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="font-mono font-medium text-foreground text-xs">{m.id}</span>
                  {m.contextWindow && Number(m.contextWindow) > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised border border-border-subtle text-foreground-subtle font-mono">
                      {Math.round(Number(m.contextWindow) / 1000)}k 窗口
                    </span>
                  ) : null}
                  {m.maxTokens && Number(m.maxTokens) > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised border border-border-subtle text-foreground-subtle font-mono">
                      {Math.round(Number(m.maxTokens) / 1024)}k 输出
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(idx)}
                    className="p-1 text-foreground-subtle hover:text-foreground hover:bg-muted rounded transition-colors cursor-pointer"
                    title="配置此模型的上下文容量与输出 Tokens"
                    aria-label={`配置模型 ${m.id}`}
                  >
                    <Sliders className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveModel(m.id)}
                    className="p-1 text-foreground-faint hover:text-danger-fg hover:bg-danger-soft rounded transition-colors cursor-pointer"
                    title="移除模型"
                    aria-label={`移除模型 ${m.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 模型参数编辑 / 添加面板 */}
      {isAdding || editingIndex !== null ? (
        <div className="p-3 rounded-xl border border-info-border/60 bg-surface-sunken space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-foreground">
              {editingIndex !== null ? "配置模型参数" : "添加模型"}
            </span>
            <span className="text-[11px] text-foreground-faint">
              上下文窗口与输出 tokens 与此模型独立绑定
            </span>
          </div>

          <div className="space-y-2">
            <div>
              <label htmlFor="model-input-id" className="block text-[11px] text-muted-foreground mb-1 font-medium">
                模型 ID <span className="text-danger-fg">*</span>
              </label>
              <input
                id="model-input-id"
                type="text"
                value={modelInputId}
                onChange={(e) => setModelInputId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveModelItem();
                  } else if (e.key === "Escape") {
                    handleCancelEdit();
                  }
                }}
                placeholder="如 deepseek-chat 或 claude-3-7-sonnet"
                className="w-full p-2 rounded-lg border border-border bg-card font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="model-input-ctx" className="block text-[11px] text-muted-foreground mb-1 font-medium">
                  上下文窗口 (Context Window)
                </label>
                <input
                  id="model-input-ctx"
                  type="number"
                  min="8192"
                  max="2000000"
                  step="1024"
                  value={modelInputCtx}
                  onChange={(e) => setModelInputCtx(e.target.value)}
                  placeholder="留空自动推断（如 128000）"
                  className="w-full p-2 rounded-lg border border-border bg-card font-mono text-xs"
                />
              </div>
              <div>
                <label htmlFor="model-input-max-tokens" className="block text-[11px] text-muted-foreground mb-1 font-medium">
                  最大输出 Tokens (Max Tokens)
                </label>
                <input
                  id="model-input-max-tokens"
                  type="number"
                  min="1024"
                  max="65536"
                  step="1024"
                  value={modelInputMaxTokens}
                  onChange={(e) => setModelInputMaxTokens(e.target.value)}
                  placeholder="留空走默认（如 16384）"
                  className="w-full p-2 rounded-lg border border-border bg-card font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancelEdit}
              className="px-2.5 py-1 rounded-md border border-border text-xs hover:bg-muted cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveModelItem}
              className="px-3.5 py-1 rounded-md bg-info-solid text-white text-xs font-medium hover:bg-info-solid-hover shadow-xs cursor-pointer"
            >
              {editingIndex !== null ? "保存参数" : "添加模型"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleStartAdd}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-strong text-xs text-foreground-subtle hover:bg-muted transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          <span>添加模型</span>
        </button>
      )}
    </div>
  );
}

export function SettingsModal({
  providerId = CUSTOM_PROVIDER_ID,
  apiKey,
  baseURL,
  model,
  accessToken,
  temperature,
  reasoningEffort = "medium",
  onReasoningEffortChange,
  maxSteps = "",
  fallbackModels = "",
  protocol,
  onProviderChange,
  onApiKeyChange,
  onBaseURLChange,
  onModelChange,
  onAccessTokenChange,
  onTemperatureChange,
  onMaxStepsChange,
  onFallbackModelsChange,
  onProtocolChange,
  onSave,
  onClose,
  providers,
  activeProviderId,
  activeModel,
  onSaveProvider,
  onDeleteProvider,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const { presets, loading } = useProviderCatalog();

  // 是否处于提供商添加 / 编辑状态
  const [editingProvider, setEditingProvider] = useState<ConfiguredProvider | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [addMode, setAddMode] = useState<"preset" | "custom">("preset");
  // 确认删除的目标 Provider ID（行内二次确认，不调浏览器原生 confirm）
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);

  // 按厂商/服务类别分组内置预设
  const groupedPresets = React.useMemo(() => {
    const groups: Record<string, typeof LLM_PROVIDER_PRESETS> = {};
    for (const p of LLM_PROVIDER_PRESETS) {
      const g = p.group || "其他";
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    return groups;
  }, []);

  // 表单临时编辑态
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"builtin" | "custom">("builtin");
  const [formPresetId, setFormPresetId] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseURL, setFormBaseURL] = useState("");
  const [formProtocol, setFormProtocol] = useState<LlmProtocol>("openai");
  const [formModels, setFormModels] = useState<ModelDefinition[]>([]);

  // 打开编辑已有 Provider
  const startEditing = (p: ConfiguredProvider) => {
    setEditingProvider(p);
    setIsAddingNew(false);
    setFormId(p.id);
    setFormName(p.name);
    setFormType(p.type);
    setFormPresetId(p.presetId || "");
    setFormApiKey(p.apiKey);
    setFormBaseURL(p.baseURL);
    setFormProtocol(p.protocol);
    setFormModels(dedupeModels(p.models || []));
  };

  // 打开新建 Provider
  const startAdding = () => {
    setIsAddingNew(true);
    setEditingProvider(null);
    setAddMode("preset");
    const defaultPreset = LLM_PROVIDER_PRESETS[0];
    setFormId(defaultPreset.id);
    setFormName(defaultPreset.name);
    setFormType("builtin");
    setFormPresetId(defaultPreset.id);
    setFormApiKey("");
    setFormBaseURL(defaultPreset.baseURL);
    setFormProtocol(defaultPreset.protocol);
    setFormModels(defaultPreset.models);
  };

  // 预设选择变化
  const handlePresetSelect = (presetId: string) => {
    const matched = presets.find((p) => p.id === presetId) || findPreset(presetId);
    if (!matched) return;
    setFormId(matched.id);
    setFormName(matched.name);
    setFormPresetId(matched.id);
    setFormBaseURL(matched.baseURL);
    setFormProtocol(matched.protocol);
    setFormModels(matched.models);
  };

  // 提交保存 Provider
  const handleSaveProviderForm = () => {
    if (!onSaveProvider) return;

    const finalId = formId.trim() || `custom-${Date.now()}`;
    const finalName = formName.trim() || finalId;
    const finalModels = dedupeModels(formModels.length > 0 ? formModels : ["default-model"]);

    const updatedProvider: ConfiguredProvider = {
      id: finalId,
      name: finalName,
      type: formType,
      presetId: formType === "builtin" ? formPresetId : undefined,
      protocol: formProtocol,
      baseURL: formBaseURL.trim(),
      apiKey: formApiKey.trim(),
      models: finalModels,
      defaultModel: getModelId(finalModels[0]),
      enabled: true,
    };

    onSaveProvider(updatedProvider);
    setEditingProvider(null);
    setIsAddingNew(false);
  };

  const preset = presets.find((p) => p.id === providerId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] sm:max-w-2xl lg:max-w-3xl rounded-2xl bg-card border border-border p-6 gap-4 text-xs"
      >
        <div className="flex items-center justify-between border-b border-border-subtle pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-info-fg" />
            <DialogTitle className="font-bold text-sm">设置</DialogTitle>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="text-foreground-faint hover:text-foreground-subtle cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as SettingsTab)}
          className="gap-4"
        >
          <TabsList className="w-full h-auto p-1 text-xs font-medium bg-muted flex overflow-x-auto no-scrollbar">
            {SETTINGS_TABS.map(({ id, label, Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="flex-1 h-auto py-1.5 gap-1.5 text-xs data-active:font-semibold data-active:text-info-fg data-active:bg-surface-active data-active:shadow-xs cursor-pointer"
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="model" className="space-y-4 text-xs mt-0">
            {/* 多 Provider 管理视图（参考 dsh 设计） */}
            {providers && providers.length > 0 ? (
              <div className="space-y-3">
                {isAddingNew || editingProvider ? (
                  /* 新增 / 编辑 Provider 表单视图 */
                  <div className="p-4 rounded-xl border border-border bg-surface-sunken space-y-3.5">
                    {isAddingNew && (
                      <div className="flex gap-2 p-1 bg-muted rounded-lg text-xs font-medium">
                        <button
                          type="button"
                          onClick={() => {
                            setAddMode("preset");
                            setFormType("builtin");
                            const defaultPreset = LLM_PROVIDER_PRESETS[0];
                            setFormId(defaultPreset.id);
                            setFormName(defaultPreset.name);
                            setFormBaseURL(defaultPreset.baseURL);
                            setFormProtocol(defaultPreset.protocol);
                            setFormModels(defaultPreset.models);
                          }}
                          className={`flex-1 py-1.5 text-center rounded-md transition-colors cursor-pointer ${
                            addMode === "preset"
                              ? "bg-card text-foreground font-semibold shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          第三方模型提供商
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddMode("custom");
                            setFormType("custom");
                            setFormId("custom-gateway");
                            setFormName("自定义网关");
                            setFormBaseURL("https://gateway.example/v1");
                            setFormProtocol("openai");
                            setFormModels([]);
                          }}
                          className={`flex-1 py-1.5 text-center rounded-md transition-colors cursor-pointer ${
                            addMode === "custom"
                              ? "bg-card text-foreground font-semibold shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          自定义模型 API
                        </button>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      {isAddingNew && addMode === "preset" && (
                        "从内置目录中选择 OpenAI、Anthropic、Kimi 等提供商，填入其 API 密钥即可使用。"
                      )}
                      {isAddingNew && addMode === "custom" && (
                        "连接中转站、自部署服务或其他兼容 OpenAI / Anthropic 协议的接口，需填写 API 地址、协议和模型。"
                      )}
                      {!isAddingNew && (
                        <div className="flex items-center gap-2 font-semibold text-foreground-strong text-sm">
                          <span>{editingProvider?.name}</span>
                          {editingProvider?.type === "custom" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised border border-border-subtle text-foreground-faint">
                              自定义
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 表单字段 */}
                    {isAddingNew && addMode === "preset" && (
                      <div>
                        <label className="block text-muted-foreground mb-1 font-medium">
                          提供商
                        </label>
                        <Select
                          value={formPresetId}
                          onValueChange={handlePresetSelect}
                        >
                          <SelectTrigger className="w-full bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72 text-xs">
                            {Object.entries(groupedPresets).map(([groupName, list]) => (
                              <SelectGroup key={groupName}>
                                <SelectLabel>{groupName}</SelectLabel>
                                {list.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                            {(() => {
                              const builtinIds = new Set(
                                LLM_PROVIDER_PRESETS.map((p) => p.id)
                              );
                              const rest = presets.filter((p) => !builtinIds.has(p.id));
                              if (!rest.length) return null;
                              return (
                                <SelectGroup>
                                  <SelectLabel>更多 Provider（models.dev 目录）</SelectLabel>
                                  {rest.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              );
                            })()}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {isAddingNew && addMode === "custom" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-muted-foreground mb-1 font-medium">
                            Provider ID
                          </label>
                          <input
                            type="text"
                            value={formId}
                            onChange={(e) => setFormId(e.target.value)}
                            placeholder="如 acme-gateway"
                            className="w-full p-2.5 rounded-lg border border-border bg-card font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-muted-foreground mb-1 font-medium">
                            显示名称
                          </label>
                          <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="如 Acme 网关 / 火山"
                            className="w-full p-2.5 rounded-lg border border-border bg-card text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* API 密钥 */}
                    <div>
                      <label className="block text-muted-foreground mb-1 font-medium flex items-center justify-between">
                        <span>API 密钥</span>
                        {!isAddingNew && (
                          <span className="text-[11px] text-foreground-faint">
                            留空使用已保存凭据
                          </span>
                        )}
                      </label>
                      <input
                        type="password"
                        value={formApiKey}
                        onChange={(e) => setFormApiKey(e.target.value)}
                        placeholder={
                          isAddingNew ? "输入 API 密钥 (sk-...)" : "留空使用已保存凭据"
                        }
                        className="w-full p-2.5 rounded-lg border border-border bg-card font-mono text-xs"
                      />
                    </div>

                    {/* 折叠区 / 基础 API 与模型配置 */}
                    <Collapsible defaultOpen={isAddingNew && addMode === "custom"}>
                      <CollapsibleTrigger className="group w-full cursor-pointer select-none py-1 text-muted-foreground font-medium flex items-center gap-1 hover:text-foreground">
                        <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-open:rotate-180" />
                        <span>自定义设置（API 地址、协议与模型目录）</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2.5 space-y-3">
                        <div>
                          <label className="block text-muted-foreground mb-1 font-medium">
                            API 地址
                          </label>
                          <input
                            type="text"
                            value={formBaseURL}
                            onChange={(e) => setFormBaseURL(e.target.value)}
                            placeholder="https://..."
                            className="w-full p-2.5 rounded-lg border border-border bg-card font-mono text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-muted-foreground mb-1 font-medium">
                            API 协议
                          </label>
                          <RadioGroup
                            value={formProtocol}
                            onValueChange={(v) => setFormProtocol(v as LlmProtocol)}
                            className="flex gap-4"
                          >
                            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                              <RadioGroupItem value="openai" />
                              <span>OpenAI 兼容</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                              <RadioGroupItem value="anthropic" />
                              <span>Anthropic</span>
                            </label>
                          </RadioGroup>
                        </div>

                        <ModelCatalogEditor
                          models={formModels}
                          onModelsChange={setFormModels}
                          baseURL={formBaseURL}
                          apiKey={formApiKey}
                          protocol={formProtocol}
                          presetId={formPresetId}
                        />
                      </CollapsibleContent>
                    </Collapsible>

                    {/* 按钮行 */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingNew(false);
                          setEditingProvider(null);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveProviderForm}
                        className="px-4 py-1.5 rounded-lg bg-info-solid text-white text-xs font-medium hover:bg-info-solid-hover shadow-xs cursor-pointer"
                      >
                        {isAddingNew ? "创建提供商" : "保存"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Provider 列表视图（dsh 风格） */
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground flex items-center justify-between">
                      <span>填入各提供商的 API 密钥即可使用其模型。</span>
                      <span className="text-[11px] text-foreground-faint">
                        共 {providers.length} 个提供商
                      </span>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                      {providers.map((p) => {
                        const hasKey = Boolean(p.apiKey?.trim());
                        const isCurrentActive = p.id === activeProviderId;

                        return (
                          <div
                            key={p.id}
                            className={`p-3 rounded-xl border transition-colors flex items-center justify-between ${
                              isCurrentActive
                                ? "border-info-border bg-info-soft/30"
                                : "border-border bg-surface-sunken hover:bg-surface-raised/40"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  hasKey ? "bg-success-solid" : "bg-foreground-faint"
                                }`}
                                title={hasKey ? "已填入 API 密钥" : "未填入密钥"}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground text-xs truncate">
                                    {p.name}
                                  </span>
                                  {p.type === "custom" && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-surface-raised border border-border-subtle text-foreground-faint">
                                      自定义
                                    </span>
                                  )}
                                  {isCurrentActive && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-info-soft-strong text-info-fg-strong font-medium">
                                      当前: {activeModel || p.defaultModel || (p.models[0] ? getModelId(p.models[0]) : "")}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-foreground-faint truncate max-w-sm mt-0.5 font-mono">
                                  {p.models?.length > 0
                                    ? p.models.map(getModelId).join(", ")
                                    : "未配置模型"}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => startEditing(p)}
                                className="px-2 py-1 text-xs text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
                              >
                                编辑
                              </button>
                              {onDeleteProvider && providers.length > 1 && (
                                deletingProviderId === p.id ? (
                                  <div className="flex items-center gap-1 bg-card px-2 py-0.5 rounded-lg border border-danger-border shadow-xs">
                                    <span className="text-[11px] text-danger-fg font-medium">确认删除？</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onDeleteProvider(p.id);
                                        setDeletingProviderId(null);
                                      }}
                                      className="px-2 py-0.5 text-[11px] bg-danger-solid hover:bg-danger-solid-hover text-white rounded font-medium transition-colors cursor-pointer"
                                    >
                                      确认
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeletingProviderId(null)}
                                      className="px-1.5 py-0.5 text-[11px] border border-border hover:bg-muted text-foreground-subtle rounded transition-colors cursor-pointer"
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setDeletingProviderId(p.id)}
                                    className="px-2 py-1 text-xs text-danger-fg hover:bg-danger-soft rounded-md transition-colors cursor-pointer"
                                  >
                                    删除
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={startAdding}
                      className="w-full py-2.5 rounded-xl border border-dashed border-border hover:border-info-border hover:bg-info-soft/20 text-xs font-medium text-foreground-subtle hover:text-info-fg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>添加模型提供商</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* 单 Provider 兼容表单视图（保持现有测试与简单配置用） */
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="settings-provider"
                    className="block text-muted-foreground mb-1 font-medium flex items-center gap-1"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>
                      Provider
                      {loading && (
                        <span className="text-foreground-faint font-normal">
                          （目录同步中…）
                        </span>
                      )}
                    </span>
                  </label>
                  <Select
                    value={providerId}
                    onValueChange={onProviderChange}
                    name="settings-provider"
                  >
                    <SelectTrigger
                      id="settings-provider"
                      className="w-full h-auto py-2.5 text-xs font-medium bg-surface-sunken border-border"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="text-xs max-h-72">
                      <SelectGroup>
                        <SelectLabel>常用</SelectLabel>
                        {LLM_PROVIDER_PRESETS.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {(() => {
                        const builtinIds = new Set(
                          LLM_PROVIDER_PRESETS.map((p) => p.id)
                        );
                        const rest = presets.filter((p) => !builtinIds.has(p.id));
                        if (!rest.length) return null;
                        return (
                          <SelectGroup>
                            <SelectLabel>全部 Provider（models.dev 目录）</SelectLabel>
                            {rest.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })()}
                      <SelectItem value={CUSTOM_PROVIDER_ID}>自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label
                    htmlFor="settings-api-key"
                    className="block text-muted-foreground mb-1 font-medium flex items-center gap-1"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>API Key</span>
                  </label>
                  <input
                    id="settings-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => onApiKeyChange(e.target.value)}
                    placeholder={preset?.keyHint ?? "sk-..."}
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-model"
                    className="block text-muted-foreground mb-1 font-medium flex items-center gap-1"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Model（手动输入，可从建议中选择）</span>
                  </label>
                  <input
                    id="settings-model"
                    type="text"
                    list={preset ? "settings-model-options" : undefined}
                    value={model}
                    onChange={(e) => onModelChange(e.target.value)}
                    placeholder={
                      preset?.defaultModel ?? "gpt-4o-mini / deepseek-chat"
                    }
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono"
                  />
                  {preset && (
                    <datalist id="settings-model-options">
                      {preset.models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                </div>

                {preset ? (
                  <Collapsible className="rounded-lg border border-border-subtle">
                    <CollapsibleTrigger className="group w-full cursor-pointer select-none px-2.5 py-2 text-muted-foreground font-medium flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5" />
                      <span>高级：协议与接口地址</span>
                      <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-data-open:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent
                      forceMount
                      className="px-2.5 pb-2.5 space-y-3 data-closed:hidden"
                    >
                      <EndpointFields
                        protocol={protocol}
                        baseURL={baseURL}
                        onProtocolChange={onProtocolChange}
                        onBaseURLChange={onBaseURLChange}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <div className="space-y-3">
                    <EndpointFields
                      protocol={protocol}
                      baseURL={baseURL}
                      onProtocolChange={onProtocolChange}
                      onBaseURLChange={onBaseURLChange}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 采样温度 (Temperature) 或 推理等级 (Reasoning Effort) 动态切换 */}
            {isReasoningModel(activeModel || model) ? (
              <div className="p-3.5 rounded-xl border border-border bg-card space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-muted-foreground font-medium flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-fg" />
                    <span>推理等级（Reasoning Effort）</span>
                  </label>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-soft-strong text-brand-fg-strong">
                    深度思考模型
                  </span>
                </div>
                <RadioGroup
                  value={reasoningEffort}
                  onValueChange={(v) =>
                    onReasoningEffortChange?.(v as "low" | "medium" | "high")
                  }
                  className="grid grid-cols-3 gap-2 pt-0.5"
                >
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted text-xs">
                    <RadioGroupItem value="low" id="effort-low" />
                    <div>
                      <div className="font-medium text-foreground">Low (低)</div>
                      <div className="text-[10px] text-foreground-faint">快速响应</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted text-xs">
                    <RadioGroupItem value="medium" id="effort-medium" />
                    <div>
                      <div className="font-medium text-foreground">Medium (中)</div>
                      <div className="text-[10px] text-foreground-faint">平衡推荐</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted text-xs">
                    <RadioGroupItem value="high" id="effort-high" />
                    <div>
                      <div className="font-medium text-foreground">High (高)</div>
                      <div className="text-[10px] text-foreground-faint">深度穷举</div>
                    </div>
                  </label>
                </RadioGroup>
                <p className="text-[11px] text-foreground-faint leading-normal">
                  控制模型在开口回答前思维链（CoT）的思考 Token 预算。思考模型由服务方锁定采样温度，故自动切换为推理等级调节。
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl border border-border bg-card space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="settings-temperature"
                    className="text-muted-foreground font-medium flex items-center gap-1.5"
                  >
                    <Sliders className="w-3.5 h-3.5 text-info-fg" />
                    <span>采样温度（Temperature）</span>
                  </label>
                  <span className="font-mono text-foreground font-medium text-xs">
                    {temperature}
                  </span>
                </div>
                <Slider
                  id="settings-temperature"
                  value={[Number(temperature) || 0]}
                  min={0}
                  max={2}
                  step={0.1}
                  onValueChange={([v]) => onTemperatureChange(String(v))}
                  className="w-full"
                />
                <p className="text-[11px] text-foreground-faint leading-normal">
                  控制生成下一个词的随机度。数值越低回答越严谨确定（数据分析与写 SQL 推荐 0.2），数值越高越富想象力。上下文容量与最大输出可在上方「模型目录」针对各个模型独立配置。
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="datasources"
            className="max-h-[60vh] overflow-y-auto pr-0.5 mt-0"
          >
            <DatasourceSettings />
          </TabsContent>

          <TabsContent
            value="mcp"
            className="max-h-[60vh] overflow-y-auto pr-0.5 mt-0"
          >
            <McpSettings />
          </TabsContent>

          <TabsContent
            value="engine"
            className="max-h-[60vh] overflow-y-auto pr-0.5 mt-0"
          >
            <EngineSettings
              maxSteps={maxSteps}
              onMaxStepsChange={onMaxStepsChange}
              fallbackModels={fallbackModels}
              onFallbackModelsChange={onFallbackModelsChange}
            />
          </TabsContent>

          <TabsContent
            value="governance"
            className="max-h-[60vh] overflow-y-auto pr-0.5 mt-0"
          >
            <GovernanceSettings
              accessToken={accessToken}
              onAccessTokenChange={onAccessTokenChange}
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={onSave}
            className="px-4 py-1.5 rounded-lg bg-info-solid text-white text-xs font-medium hover:bg-info-solid-hover shadow-xs cursor-pointer"
          >
            保存配置
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
