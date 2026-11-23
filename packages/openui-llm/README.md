# @openui-analytics/llm

领域中立的 LLM 编排装配层：面向 OpenUI 平台的多应用统一分析入口，负责
streamText 生命周期、模型链韧性（WS-9）、流中继（StreamHub）、并发/配额/预算
三维熔断、上下文投影治理与多应用接缝；底层执行、韧性、计量与状态图由通用底座
`@openui-analytics/harness-core` 驱动。**本包零应用领域语义**——任何应用的
prompt、工具、交付物文案全部经四接缝由应用包注入
（如 `@openui-apps/analytics`）。

## 包定位

- **平台编排层**：位于宿主应用与通用 Harness 底座之间，只关心「如何安全地把一次
  多步生成跑完」，不关心「生成什么」。
- **零基础设施重复建设**：上下文压缩、Token 计量、工具拦截、双重终态状态机、
  流中继均由 `@openui-analytics/harness-core` 提供，本包做装配与策略接线。
- **依赖极简**：仅依赖 `harness-core`、`app-sdk`（协议类型）与 `ai`；不依赖
  datasources / methodology / components 等领域包。

## 应用接缝（唯一的领域注入口）

| 接缝 | 选项 | 说明 |
| --- | --- | --- |
| `resolveAppPrompt(appId, ctx)` | `AnalyzeHandlerOptions.resolveAppPrompt` | 应用自治 System Prompt；返回 undefined 用平台中立兜底（`getPlatformBasePrompt`） |
| `resolveAppTools(appId, ctx)` | `AnalyzeHandlerOptions.resolveAppTools` | 应用工具集（经遥测切面包装后挂载；数据源工具由应用装配） |
| 交付物契约 | `deliverable: AppDeliverableContract` | finish_task 终态语义（描述/拒绝文案/收尾指令/证据标记） |
| 收尾钩子 | `onTaskFinish(event)` | onFinish 后异步触发（应用登记编排状态，如 pendingPlan） |

`AppResolutionContext`（ctx）向应用开放：`mode / sessionId / messages / userQuery /
enabledSources / activeSources（MCP 源摘要）/ sessions（会话上下文通道）/ warn（遥测出口）`。

**平台强制纪律**：所有 System Prompt 经 `withPlatformGuardrails` 追加
「Untrusted Data Handling」注入防御段（应用 prompt 已含则不重复）。

## 核心机制

- **三态交互模式**：`direct` / `plan` / `execute`（语义由应用定义；平台只做归一与
  maxSteps 预算分档）。
- **模型链韧性（WS-9）**：主模型 + fallback 链；仅未产出任何 content 分块时允许
  切换（防重复输出/重复执行工具副作用）；context_overflow 可换更大窗模型并重投影。
  流消费按行检测 data stream 错误分块（`3:` 前缀，行缓冲容忍 read 字节边界不对齐）
  并还原为真实抛错进入分类/fallback/遥测——ai@4 缺省把流内 provider 失败脱敏为
  `"An error occurred."`，此处经 `getErrorMessage` 还原原始错误消息。
- **坏工具调用兜底（三层防线之二）**：`experimental_repairToolCall` 把参数校验失败
  （InvalidToolArgumentsError）与幻觉工具名（NoSuchToolError）重定向到内部反馈工具
  `__tool_call_feedback__`（经 `experimental_activeTools` 对模型隐藏，仅 repair 重定向
  可达）——错误详情 + 目标工具 JSON Schema 以 tool result 反馈给模型自我纠正，
  **单次手误不终结会话流**；每次重定向发 `TOOL_CALL_REPAIRED` 遥测（含原始 args 与
  校验原因）。其他错误返回 null 走原生抛错路径。
- **流中继（StreamHub）**：后台续跑 + 多端重放续接 + 看门狗 + 终态 30s 保留窗
  （`reconnect=true` / `action=stop`）。
- **三维熔断**：并发准入（`LLM_MAX_CONCURRENT_TASKS`，429）→ 租户配额（WS-11）→
  任务 token 预算（`budget_exhausted` 终态 + 独立 abort，只取消 provider 不破坏流）。
- **上下文投影治理**：两阶段压缩（tool-result pruning → LLM 摘要缓存复用）；
  摘要提示词可注入（`summaryPromptBuilder`，缺省 harness-core 通用版）。
- **finish_task 空跑防护**：证据标记命中（deliverable.evidenceMarkers，缺省
  ```` ```openui ```` ）或实质文本产出才允许 `completed`。
- **上下文治理锚点**：`sessions` 通道读写 `lastPromptTokens` 实测锚点与摘要缓存。

## 请求流转时序

1. 鉴权/中止/重连预检 → 并发与配额准入；
2. 凭证守卫（自定义 baseURL 必须自带 apiKey；fallback 同理）；
3. MCP 扩展工具装配（平台级数据面）→ `resolveAppTools` 应用工具装配（遥测切面包装）；
4. `resolveAppPrompt` → 平台守卫段封装 → 上下文投影（预算/剪枝/摘要）；
5. streamText 循环（模型链 + finish_task + 证据累计 + 预算熔断）→ StreamHub 挂载；
6. onFinish：终态归一 + finops 双写 + `onTaskFinish` 钩子 + token 锚点回写。

## 测试

- `src/handler.test.ts` / `auth.test.ts` / `crossReplica.test.ts`：平台机制回归
  （凭证/并发/韧性/终态/治理；应用工具经 `resolveAppTools` stub 注入）。
- `src/evals/trajectories.test.ts`（Tier A，CI）：脚本化模型剧本全链路断言——
  事件序列、单步锚点、投影、不变量门。
- 真实模型评测（Tier B）在应用包：`pnpm eval:tier-b`
  （`@openui-apps/analytics/src/evals/`）。

## 扩展指南

- **新增应用接缝能力**：改 `AnalyzeHandlerOptions` + `AppResolutionContext`，
  保持缺省行为中立（不注入 = 零行为变化）。
- **平台提示词纪律**：新增强制段加到 `platformPrompt.ts` 的
  `withPlatformGuardrails`，并做去重标记。
