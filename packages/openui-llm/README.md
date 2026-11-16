# @openui-analytics/llm

LLM 编排层：把 Vercel AI SDK 的流式文本生成、多数据源 MCP 工具循环、会话上下文治理与断线重连中继装配成
一个可直接挂到 Next.js 路由的 `POST` 处理函数——app 侧只留 `src/app/api/analyze/route.ts` 薄壳注入依赖。

## 包定位与依赖

- 依赖三个兄弟包：`@openui-analytics/datasources`（工具装配与 Certified 口径）、`@openui-analytics/methodology`（方法卡注入）、`@openui-analytics/chart-spec`（SpecChart schema）。
- 外部依赖：`ai`（Vercel AI SDK：`streamText` / `createDataStreamResponse` / Data Stream Protocol v1）、`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@openuidev/lang-core`（server 侧组件定义与 `createParser`）。
- 依赖注入边界：数据源单例、方法论库、会话上下文存取、流中继中枢、认证口径库全部由 `createAnalyzeHandler(opts)` 注入，包内不自建单例（`streamHub`/`certifiedStore` 有缺省值）。
- prompt 资产（`prompt.ts`/`serverLibrary.ts`）为包内部件，不从 `index.ts` 导出；`serverLibrary` 经子路径 `@openui-analytics/llm/serverLibrary` 暴露给需要校验一致性的测试与工具。

## 目录结构

| 文件 | 职责 |
|---|---|
| `src/handler.ts` | 编排门面 `createAnalyzeHandler`：请求解析、模式分派、工具装配、上下文治理、双重终态、SSE 输出 |
| `src/streamHub.ts` | `SessionStreamHub` 会话流中继：后台 Reader、分块缓冲、无缝重连重放、显式中止、终态 30s 保留 |
| `src/context.ts` | 投影式上下文治理：窗口查表、token 估算、剪枝投影、摘要生成与缓存 |
| `src/prompt.ts` | OpenUI Lang 提示词资产：few-shot 示例、组件清单、数据源指引、Schema Card / 方法索引 / Certified 段落拼接 |
| `src/serverLibrary.ts` | server 侧 `defineComponent` 组件定义（LLM 选组件/模板的依据；`component: () => null` 不参与渲染） |
| `src/crossSourceMap.ts` | 跨源联合映射（`config/cross-source-map.json`，完全用户维护，代码零硬编码源名） |
| `src/reasoningStream.ts` | 推理思考流转换器：非标准字段（`reasoning_content`/`reasoning`/`thought`）映射为 `<think>` 标签 |
| `src/index.ts` | 统一入口（含跨源配对解析的受控导出） |

## 架构

### 编排管线（handler.ts）

```
POST(req)
 ├─ action=stop ──────────────► streamHub.abortTask(sessionId)（显式终止后台任务）
 ├─ reconnect=true 且有在途任务 ─► streamHub.createResponse()（重放缓冲 + 续接，不重复调用 streamText）
 ├─ 凭证守卫：自带 baseURL 必须同时自带 apiKey（防服务端 env Key 外泄到任意 URL）
 ├─ 无 Key ───────────────────► 返回合规 Data Stream 分块（InsightBox 引导去设置页）
 ├─ 协议分派：protocol=anthropic（/v1/messages）或缺省 openai 兼容（/chat/completions）
 │    └─ createReasoningFetch() 拦截上游 SSE + extractReasoningMiddleware(tagName:"think")
 │       统一兼容 DeepSeek/Qwen/GLM/Moonshot 等推理型模型
 ├─ 数据源：resolveActive(请求 sources ∩ 全局启用 ∩ 实际存在)；逐源装配工具
 │    └─ Promise.allSettled——单一源失败降级空工具集，不拖垮整个请求
 ├─ system prompt 组装：模式变体 + Schema Card 摘要（总量 8KB 预算，按提问相关度展开）
 │    + 方法索引 / execute 命中方法卡详情（≤2 张）+ Certified 口径段 + 跨源规则段
 ├─ 上下文治理（context.ts）：窗口查表 → 预算 → 剪枝投影 → 超限时摘要替换
 └─ createDataStreamResponse：streamText 多步工具循环
      ├─ tools = 数据源工具 + cross_source_link（条件注册） + finish_task
      ├─ onStepFinish：记录最后一步单步 promptTokens → 实时下发 context_usage
      └─ onFinish：双重终态判定 + token 锚点回写（单步实测值）
```

### 流中继（streamHub.ts）

服务端与客户端生命周期解耦的核心。每个会话任务由**服务端独立 Reader** 持续消费上游流：

- **分块缓冲**：全部 SSE 分块存入 `task.chunks`，与订阅者数量无关；
- **多订阅者广播**：`createResponse()` 先瞬时重放全部历史分块，再注册为实时订阅者续接增量；
- **终态保留 30s**：任务完成后保留 30 秒供「刷新完成但错过直播」的页面做最后重放，之后自动清理（`scheduleCleanup`）；
- **即刻中止**：`abortTask` 除 `abort()` 外还 `cancelUpstream()`——解除阻塞在 `read()` 上的 reader，避免上游继续烧 token；
- **同会话新任务**：`registerAndConsume` 遇未完成旧任务先中止，保证一会话一任务。

### 上下文治理（context.ts）

投影式压缩：**存储层历史不动**，只对发往 LLM 的消息做投影。

1. 窗口解析：`resolveContextWindow` 按模型名前缀查表（钳制 8k–2M，缺省 128k），客户端 hint 优先；
2. 预算：`computeBudget(窗口, maxOutputTokens)` 得出触发阈值 `triggerAt`；
3. 估算：CJK ≈1.5 字符/token、其余 ≈4 字符/token（`estimateTextTokens`），锚点优先用服务端回写的 `lastPromptTokens` 实测值；
4. 剪枝：超预算时从旧到新把 tool 结果替换为占位符（保留工具名与调用关联，`PRUNED_PLACEHOLDER`），最后一张 PlanReviewCard 受保护；
5. 摘要：剪枝不够时对更早的消息生成 ≤2048 token 摘要注入 system，游标 `summaryUptoMessageId` 缓存复用；失败静默退化为纯剪枝，不阻塞分析。

## 业务逻辑

### 双重终态机制

每轮分析必须有确定的结束信号，两条路径互补：

- **显式**：模型调用 `finish_task` 工具（`completed` / `insufficient_data` / `blocked`），下发 `task_finish(termination: "explicit")`，并约束「已输出报告/看板时只补一句闭环致辞，严禁重复输出」；
- **自然兜底**：`onFinish` 时若无显式信号，按最后一步 `finishReason` 判定——`stop`/`undefined` → natural completed；`length` → `step_limit_reached`（截断警示）；其余 → 以该 reason 为 termination 记录。

### 断线重连时序

1. 客户端脱钩（切会话/刷新）后服务端任务继续后台生成并缓冲；
2. 回切时客户端探针 `GET /api/analyze?sessionId=` → `{ running, hasTask }`（`running` 由 `POST.isSessionRunning` 提供，`hasTask` 覆盖终态 30s 保留窗）；
3. 判定需续接则 `reload({ body: { reconnect: true } })` → handler 命中 `streamHub.hasTask` → `createResponse` 重放历史分块 + 续接增量；
4. 不满足条件才发起新请求；同会话新请求自动中止旧任务。

### token 锚点归属

`context_usage` 与 `lastPromptTokens` 锚点**只由服务端按最后一步单步实测值**写入（`lastStepPromptTokens`，不能使用 AI SDK 多步工具调用的累加值——多步累计会让剪枝判定与展示虚高）。客户端只消费展示，不持久化。

### 跨源联合分析

能力成立无独立开关，由配置驱动：`config/cross-source-map.json` 存在映射、且映射双侧源 id 都在当前激活源集合内时，`resolveCrossSourcePairs` 才返回配对——此时才注册 `cross_source_link` 工具、注入提示词规则段；会话级取消勾选任一侧源即自动关闭。映射缺失时工具返回 `confidence=none` 并提示补配置，禁止模型编造关联。

## 功能清单

| 导出 | 用途 |
|---|---|
| `createAnalyzeHandler(opts)` | 编排门面，返回 Next.js POST 处理函数；opts：`datasources`（必选）、`methodology`、`sessions`、`streamHub`、`certifiedStore` |
| `POST.isSessionRunning(sessionId)` | 函数属性：会话是否有 running 任务（探针 `running` 字段） |
| `POST.abortSession(sessionId)` | 函数属性：显式中止会话后台任务 |
| `POST.streamHub` | 函数属性：中继实例（探针 `hasTask` 等） |
| `SessionStreamHub` / `defaultStreamHub` | 会话流中继类与全局单例 |
| `SessionStreamTask` | 任务记录类型（sessionId/chunks/subscribers/status/abortController） |
| `resolveCrossSourcePairs(activeIds)` | 依配置解析当前成立的跨源配对（`/api/datasources` 的 features 标志同源判定） |
| `createReasoningFetch` / `createReasoningContentTransformStream` | 上游 SSE 推理字段标准化拦截 |
| 类型：`AnalyzeHandlerOptions` / `AnalyzeRequestBody` / `SessionContextMeta` / `SessionContextStore` | 注入契约与请求体契约 |

## 如何扩展

- **新增展示组件/布局模板（三处联动，勿漏）**：app 侧组件实现 + `serverLibrary.ts` 加 server def（`description` 写清适用场景，是 LLM 选型的依据）+ `prompt.ts` 组件清单/few-shot——后者受 `promptExamples.test.ts` 守护：示例代码经 `createParser` 全量解析，并与 serverLibrary 组件名一致性校验。
- **新增 prompt 段落**：在 `prompt.ts` 以纯函数段（如 `certifiedQueriesSection`）接入对应模式变体，参数化内容不写死数据源名。
- **调整治理策略**：窗口表 / 预算系数 / 估算常数集中在 `context.ts` 顶部，改后跑 `context.test.ts` 锁定行为。

## 测试

`pnpm test`（vitest）。守护重点：

- `handler.test.ts`（31 用例）：双重终态识别、流重连（重连不重复调用 streamText）、步数预算钳制、凭证守卫、模式分派、Schema Card 预算、跨源工具条件注册等；
- `streamHub.test.ts`：注册/重连重放/中止即刻生效/终态保留；
- `context.test.ts`：窗口查表、剪枝投影、摘要游标复用、截断保护；
- `promptExamples.test.ts`：few-shot 示例全量解析 + 与 serverLibrary 组件名一致性；
- 其余：`prompt.test.ts`（段落拼接）、`certifiedPrompt.test.ts`、`crossSourceMap.test.ts`、`reasoningStream.test.ts`（非标准字段映射）。
