# @ginkgo/harness-core

企业级通用 LLM Harness 执行与治理底座：领域无关、零业务硬编码、中间件驱动，具备输出自愈、状态图编排、上下文生命周期治理、工具执行切面、多租户成本控制与分布式流式任务治理能力。

## 包定位

- **通用执行与治理引擎底座**：作为 monorepo 中通用 AI Agent 与 LLM 调用的核心运行时底座，封装所有与具体分析业务无关的基础设施能力（通信弹性、中间件管线、上下文生命周期治理、工具调用拦截、双重终态状态机、成本核算、可观测性等）。
- **零业务假设与绝对领域正交**：包内严禁包含任何上层应用的领域语义、专用展示组件或业务 DSL，作为标准、通用的底层框架为上层业务编排层（如 `@ginkgo/llm`）或其他 AI 应用提供执行保障。
- **依赖生态**：基于 Vercel AI SDK（`ai`）、`@modelcontextprotocol/sdk`、`zod` 构建，提供针对 Redis、分布式文件及内存的多种存储与账本适配器。

---

## 核心架构

Harness 采用**分层松耦合、门面装配、切面穿透、上下文治理与状态图编排**的架构设计：

```
+-----------------------------------------------------------------------------------------------+
|                                    HarnessCore (统一门面入口)                                   |
|   - 分层配置解析 (环境变量/动态覆盖)  - 会话流中继 (StreamHub)   - 统一 MCP Client Manager      |
|   - 成本核算台账 (CostLedger)       - 任务快照存储 (TaskStore)  - 全局遥测入口 (Telemetry)     |
+-----------------------------------------------+-----------------------------------------------+
                                                |
        +---------------------------------------+---------------------------------------+
        |                                       |                                       |
        v                                       v                                       v
+-------------------------------+   +-------------------------------+   +-------------------------------+
|   洋葱中间件管线 (Pipeline)     |   |    状态图编排 (StateGraph)     |   |    上下文治理引擎 (Context)    |
| - 凭证检查 (CredentialGuard)  |   | - 节点动作 (NodeAction)       |   | - 动态窗口查表 (8k-2M 钳制)   |
| - 并发限流 (ConcurrencyGate)  |   | - 条件路由 (Router)           |   | - 水位预算计算 (computeBudget)|
| - 租户配额 (TenantQuota)      |   | - 快照检查点 (Checkpointer)   |   | - 工具结果剪枝 (Pruning 协议) |
| - 输出自愈 (AutoHealing)      |   | - 人工介入断点 (Breakpoint)    |   | - 边界净化与首条 user 规范    |
| - 三维熔断 (BudgetController) |   | - 恢复执行与状态合并          |   | - 增量滚动历史摘要生成        |
+---------------+---------------+   +---------------+---------------+   +---------------+---------------+
                |                                   |                                   |
                +-----------------------------------+-----------------------------------+
                                                    |
                                                    v
+-----------------------------------------------------------------------------------------------+
|                                   运行时切面、终态与基础设施层                                 |
| - 工具执行切面 (Tool Interceptors: 遥测统计 TelemetryAspect、单工具超时熔断 TimeoutAspect)    |
| - 任务生命周期与双重终态 (TaskLifecycleMachine: 显式终态工具契约、可插拔交付物断言、自然停机兜底)|
| - Tokenizer 计量与编码 (TokenizerProvider: 启发式估算、Tiktoken BPE 编解码器与模型映射)      |
| - 通信弹性与重试 (ResilientFetch: 指数退避抖动、分类重试、网络故障与 429 自动熔断降级)        |
| - FinOps 成本治理 (模型定价矩阵、输入/输出/缓存计费、多后端台账: Memory / File / Redis)        |
| - 高可用流中继 (SessionStreamHub: 服务端独立 Reader、多端广播重放、断线瞬时续接、租约孤儿清理)  |
| - 推理流字段标准化 (Reasoning: reasoning_content / thought 统一归一化为标准 <think> 标签)      |
+-----------------------------------------------------------------------------------------------+
```

### 1. 统一管理门面（HarnessCore）
通过聚合配置解析、存储适配器装配、MCP 客户端管理、流中继中心与成本账本，对外提供简洁的单例初始化入口，支持在运行时通过配置补丁热更新参数。

### 2. 洋葱模型执行管线（Pipeline & Middlewares）
提供类似 Koa 的洋葱中间件执行链路，对每个 LLM 请求依次执行前置凭证校验、并发门禁、租户限额、上下文增强及后置自愈重试，确保执行流的安全受控。

### 3. 通用上下文治理引擎（Context Engine）
针对长历史与多步 Agent 工具调用导致的 Token 膨胀，提供两阶段上下文治理：
- **第一阶段（Pruning 工具剪枝）**：在保留窗口外仅裁剪工具返回的体积，严格保留 `tool-call` 与 `tool-result` 配对标识（保持 LLM 协议合法），支持业务自定义消息保护规则；
- **第二阶段（增量摘要 Compaction）**：总量仍超阈值时触发历史分段增量摘要，并执行严格的边界净化算法，剔除孤儿工具消息，确保首条消息符合模型提供商规范。

### 4. 工具执行切面管道（Tool Interceptors）
采用拦截器链模式包装工具执行（`composeToolInterceptors`）：
- **遥测切面（TelemetryAspect）**：透明统计工具执行毫秒数、输入输出字节量与成败状态并上报遥测；
- **超时切面（TimeoutAspect）**：对单次工具执行施加强制超时熔断，防止第三方接口卡死整个任务。

### 4.1 zodTool —— zod 工具定义适配（ai@4.3 + zod@4 兼容缺口）

ai@4.3 的 `asSchema` 对 zod@4（standard schema）做模型侧 JSON Schema 转换时**丢失参数结构**（只剩 `$schema` 声明），模型看不到参数必然乱传。`zodTool` 保持 zod schema 为单一事实来源，两端各取所需：

- **模型侧**：zod@4 内置 `z.toJSONSchema`（draft-7，io=input）生成完整 `properties`/`required`/`description`；
- **校验侧**：`jsonSchema()` 宽松入口 + execute 首行 `safeParse`，失败返回结构化 `{ error, isError }` 反馈给模型自我纠正（不上抛、不终结会话流）。

**包内全部 zod 工具（terminationTool 等）已统一经它包装；新工具一律用 `zodTool` 而非裸 `tool()` + zod schema。**

### 4.2 MCP 工具适配的错误约定

`adaptMcpToolToCoreTool` 的 execute 整体防御：MCP server 业务错误（`isError`）与传输层失败（网络/超时/未注册）一律返回结构化 `{ error, isError: true }` 反馈给模型——**execute 抛错在 ai@4 中会作为 ToolExecutionError 终结整个会话流**，工具级错误不应杀死会话。

### 5. 任务生命周期与双重终态（Task Lifecycle Machine）
提供标准化显式终态工具协议（`createTerminationTool`）与双重终态状态机：
- 状态机综合管理 Agent 执行步数与已调用工具清单；
- 在模型宣告 `completed` 时触发可插拔的**交付物断言契约（DeliverableAssertion）**，防止 Agent 空跑无实质产出提前闭环；
- 若未显式调用终态工具，根据模型最后步骤状态自动进行自然停机（natural stop）或截断兜底。

### 6. 状态图编排与人机协同（StateGraph & Human-in-the-Loop）
提供有向状态图执行能力。每个节点接收全局状态并返回状态更新补丁；支持条件边动态路由；内置基于 Checkpointer 的快照机制，支持在关键节点配置断点（Breakpoint）暂停执行，等待人工审批或外部输入后无缝恢复执行。

---

## 核心功能清单

- **上下文生命周期与压缩治理（Context）**：
  - `resolveContextWindow`：模型上下文窗口动态解析与安全范围钳制（8k–2M）；
  - `computeContextBudget`：动态计算安全触发阈值与最近历史保留预算；
  - `projectMessagesWithPruning`：保持原消息不可变，生成投影消息并按协议保护执行工具剪枝；
  - `trimOrphanToolMessages`：净化边界孤儿工具消息并自动补全前置 user 衔接消息；
  - `buildGenericSummaryPrompt`：通用增量摘要提示词模板生成。
- **Tokenizer 计量与模型编码解析（Tokenizer）**：
  - `HeuristicTokenizer`：零依赖快速 CJK/ASCII 启发式 Token 计数器；
  - `createTiktokenEstimator`：peer optional 动态加载的真实 BPE 编解码器（带实例缓存）；
  - `resolveEncodingForModel`：模型名称前缀最长匹配查表。
- **工具拦截器切面管线（Tools）**：
  - `composeToolInterceptors`：洋葱模型工具拦截器链编排；
  - `createTelemetryInterceptor`：耗时、数据体量与执行结果监控切面；
  - `createTimeoutInterceptor`：单工具执行硬超时保护。
- **任务终态与交付断言（Lifecycle）**：
  - `createTerminationTool`：标准化任务终态声明工具契约；
  - `DeliverableAssertion`：业务可插拔的交付物与证据验收回调接口；
  - `TaskLifecycleMachine`：管理 Step 进度、显式工具信号与隐式停机决议的状态机。
- **三维资源防跑飞熔断器（BudgetController）**：
  - `ExecutionBudgetController`：步数上限、累计 Token 上限与墙钟耗时三维熔断控制，绑定 `AbortController`。
- **洋葱中间件套件（Pipeline Middlewares）**：
  - 凭证守卫（`createCredentialGuardMiddleware`）、并发限流门禁（`createConcurrencyGateMiddleware`）、租户配额（`createTenantQuotaMiddleware`）、自愈重试中间件（`createAutoHealingMiddleware`）。
- **模型提供商与通信弹性（Providers & Resilience）**：
  - 统一适配 OpenAI、Anthropic 及兼容推理模型协议；
  - `createResilientFetch`：指数退避、随机抖动、状态码分类重试与模型链路降级（Fallback Chain）。
- **FinOps 成本核算台账（FinOps）**：
  - 内置每百万 Token 输入/输出/缓存读取的计费价格表（`ModelPricingTable`）；
  - 提供多存储实现：`InMemoryCostLedger`、`NdjsonCostLedger`、`RedisCostLedger`。
- **高可用流式任务中继（SessionStreamHub）**：
  - 服务端独立 Reader 消费与分块缓冲，支持切页/断网不中断后台推理；
  - 多端订阅重放、断线即刻续接、终态保留窗口回溯与跨副本租约清扫（TaskStore: Memory / File / Redis）。
- **可观测性遥测（Telemetry）**：
  - 统一事件模型覆盖任务全生命周期；
  - 支持 `createConsoleSink`、`createMetricsSink`（Prometheus 指标）与 `createOtelSink`（OpenTelemetry 分布式链路）。
- **MCP 客户端统一管理（MCPClientManager）**：
  - 支持 Stdio / SSE / HTTP 传输协议的连接池管理；
  - 自动将 MCP 规范转换为 Vercel AI SDK 兼容的 CoreTool 实例。

---

## 业务逻辑与流转机制

### 1. 两阶段上下文压缩流转
1. 请求到达前，上下文引擎根据模型窗口计算触发阈值（如总窗 70%）与保留预算（如 25%）；
2. 预估 Prompt Token（支持实测锚点与 Tokenizer 计量）。若未超阈值，原样直发，零开销；
3. 超出阈值时，保留窗口逐字保留，保留窗口外的过时工具调用结果替换为安全占位符；
4. 剪枝后若依然超出阈值，计算摘要截断游标，触发增量摘要模型压缩较早轮次，并自动清理边界孤儿工具消息。

### 2. 工具切面与遥测流转
1. 原始工具集经 `composeToolInterceptors` 包装，不侵入工具原有入参参数与业务执行逻辑；
2. 工具调用触发时，依序穿过超时检查器与遥测切面；
3. 执行成功或抛出异常时，切面捕获耗时并计算出入参字节体量，向遥测中心发射 `tool_result` 事件后继续透传或向上抛出。

### 3. 双重终态与交付断言流转
1. **显式终态声明**：模型调用 `finish_task` 声明完成；
2. **交付断言检查**：状态机读取上层注入的 `DeliverableAssertion`。若未产出实质性内容（如空跑结束），工具立即返回结构化错误指导模型补全输出；若通过断言，正式下发 `task_finish(explicit)`；
3. **自然停机兜底**：模型自主 stop 或达到步数截断时，状态机根据最终输出特征归一化为自然完成或异常截断事件。

### 4. 状态图执行与断点挂起恢复
1. 从 `START` 节点出发，根据边配置或条件路由跳转至节点执行动作；
2. 每次节点执行返回局部状态切片，通过 Reducer 更新全局状态并写入 Checkpoint 快照；
3. 遇到声明了断点的节点前持久化挂起，等待人工介入或审批；接收恢复指令后从快照处无缝继续执行。

---

## 扩展指南

- **自定义交付断言（DeliverableAssertion）**：
  在上层业务装配 `createTerminationTool` 时注入断言回调，根据业务场景检查是否产出文本、图表、卡片或特定产物。
- **添加工具拦截切面（ToolInterceptor）**：
  实现 `ToolInterceptor` 契约，在 `next(args)` 前后加入自定义的限流、参数脱敏或缓存逻辑，并通过 `composeToolInterceptors` 挂载。
- **自定义消息保护策略**：
  在上下文引擎中传入 `isProtectedMessage(msg, index, total)`，为特定的交互卡片或系统指令提供豁免保护。
- **添加新中间件与状态机节点**：
  实现 `HarnessMiddleware` 挂载到 `HarnessPipeline`，或使用 `StateGraph` 构建复杂的循环/分支工作流。
