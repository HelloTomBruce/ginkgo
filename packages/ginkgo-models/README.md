# @ginkgolab/models

Ginkgo 智能体应用平台**统一模型与 Provider 规范契约、预设与同构元数据层**。

## 设计定位

在 LLM 应用中，模型配置与 Provider 字典往往容易在前端客户端（设置中心、输入框切换器）和服务端调度层（Harness 编排、探针校验、上下文预算）之间产生重复定义与依赖倒置：
- 若将模型契约放入 `@ginkgolab/llm`，会导致前端引入 Node.js/Redis/Agent 编排等重依赖，破坏前后端隔离；
- 若散落在宿主前端代码中，服务端与 Harness 底座又无法共享真值，造成模型上下文计算、推理模型嗅探等逻辑割裂。

`@ginkgolab/models` 作为独立的 **L2 纯同构核心包**，严格遵循：
- **零外部第三方依赖（Zero-Dependency）**：仅采用纯 TypeScript 实现，无任何 runtime 依赖；
- **全同构支持**：兼顾 Node.js、Edge 与现代浏览器环境，安全访问 `localStorage` 与 `globalThis`；
- **单一事实来源（Single Source of Truth）**：全平台唯一的 Provider 预设目录、模型归一化、思考/推理判定与上下文容量规范。

---

## 核心能力

### 1. 协议与类型契约 (`types.ts`)
- `LlmProtocol`：标准协议定义（`"openai" | "anthropic"`）。
- `ModelConfig` / `ModelDefinition`：支持从简单的字符串到带独立上下文窗口（`contextWindow`）、最大输出（`maxTokens`）、思考模型（`supportsReasoning`）及开关状态（`enabled`）的高级模型配置。
- `ConfiguredProvider`：前端多 Provider 持久化数据结构，支持多模型绑定与自定义端点。
- `ReasoningEffort`：推理深度规格（`"low" | "medium" | "high"`）。

### 2. 官方精选预设目录 (`presets.ts`)
收录国内外 20+ 主流厂商与开源框架预设：
- **国内主流**：DeepSeek、Kimi（Moonshot）、Kimi Coding（Anthropic 协议）、智谱 GLM、智谱 Coding、阿里通义千问（Qwen）、通义灵码专线、字节火山方舟（Ark）、火山 Coding、MiniMax、百度千帆、腾讯混元等；
- **国际主流**：OpenAI（GPT-4o/o3-mini/o4-mini）、Anthropic（Claude 3.7/Sonnet 4.5/Haiku 4.5）、Google Gemini（2.5 Flash/Pro）、Groq、xAI Grok、Mistral AI 等；
- **聚合路由与网关**：SiliconFlow（硅基流动）、OpenRouter、DeepInfra、Together AI 等；
- **本地与开源部署**：Ollama、vLLM、LM Studio 等。

### 3. 模型智能推断与去重 (`utils.ts`)
- `isReasoningModel(model, config?)`：支持显式配置指定与 ID 模式（o1/o3/r1/qwq/reasoner/thinking/claude-3-7+/claude 4 系）自动智能嗅探。
- `dedupeModels(list)`：按模型 ID 去重，混合存在对象与字符串配置时优先保留对象结构体，杜绝重复渲染。
- `ensureModelInList(list, targetModel)`：安全追加或置顶模型。
- `getRecentModels()` / `recordRecentModel(providerId, model)`：基于 LRU 队列记录最近使用的模型。

### 4. 上下文容量与动态目录 (`catalog.ts`)
- `DEFAULT_MODEL_WINDOW_MAP`：前缀匹配的权威上下文窗口大小字典（128k ~ 2M tokens）。
- `resolveContextWindow(model, clientHint?)`：客户端指定值优先，辅以前缀贪婪匹配与边界钳制（8k ~ 2M）。
- `ModelCatalogRegistry`：支持动态扩展与自定义模型上下文注册。
- `ensureProviderCatalog()` / `mergePresets()`：对接社区 `models.dev` 动态全量 Provider 目录拉取、过滤、本地 24h 缓存与内置预设无缝合并。

---

## 安装与使用

```bash
pnpm add @ginkgolab/models
```

### 示例代码

```typescript
import {
  isReasoningModel,
  resolveContextWindow,
  findPreset,
  dedupeModels,
} from "@ginkgolab/models";

// 1. 判断是否为思考/推理模型
isReasoningModel("deepseek-reasoner"); // true
isReasoningModel("o3-mini");           // true
isReasoningModel("gpt-4o");            // false

// 2. 解析上下文窗口容量
const windowSize = resolveContextWindow("claude-sonnet-4-5"); // 200,000

// 3. 查询内置 Provider 预设
const kimiPreset = findPreset("kimi-coding");
console.log(kimiPreset?.protocol); // "anthropic"

// 4. 安全合并并去重模型列表
const merged = dedupeModels([
  "deepseek-chat",
  { id: "deepseek-chat", contextWindow: "128000" },
  "deepseek-reasoner",
]);
```

---

## 测试与质量

```bash
pnpm --filter @ginkgolab/models test
```
全量单测覆盖类型归一化、推理判断、上下文窗口计算、去重合并与动态目录拉取转换。


## License

MIT © 2026 Ginkgo contributors — 完整条款见包内 `LICENSE`（或仓库根 `LICENSE`）。
