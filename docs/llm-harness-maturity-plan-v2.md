# LLM Harness 成熟化实施方案 v2.1

> 版本：v2.1 · 2026-11-18（v2.0 修订：定位从「单进程产品级」升级为「**可水平扩展的多进程 harness**」，
> WS-8 的 Redis 后端从后置可选项提升为核心交付物，并发准入/配额/abort 全部改为分布式语义）
>
> ⚠️ **历史快照（2026-11-18，v2.1）**：本文是当时的成熟化方案，用于追溯决策，**不代表当前文件布局**。
> 文中提到的 `packages/ginkgo-llm/src/{costLedger,otelSink,resilience,streamHub,taskStore}.ts`
> 均已迁入 `packages/ginkgo-harness-core/src/**`（finops / telemetry / providers / stream）；
> `config/model-pricing.json`、`config/model-tokenizer.json` 的语义现为「**存储根**下 `config/`」
> （见 [docs/guide/environment-variables.md](guide/environment-variables.md)）。以当前代码为准。
>
> **文中路径 → 当前位置**：
>
> | 文中的路径 | 现在的位置 |
> | --- | --- |
> | `packages/ginkgo-llm/src/resilience.ts` | `packages/ginkgo-harness-core/src/providers/resilience.ts` |
> | `packages/ginkgo-llm/src/streamHub.ts` | `packages/ginkgo-harness-core/src/stream/streamHub.ts` |
> | `packages/ginkgo-llm/src/taskStore.ts` | `packages/ginkgo-harness-core/src/stream/taskStore.ts` |
> | `packages/ginkgo-llm/src/costLedger.ts` | `packages/ginkgo-harness-core/src/finops/costLedger.ts` |
> | `packages/ginkgo-llm/src/otelSink.ts` | `packages/ginkgo-harness-core/src/telemetry/otelSink.ts` |
> | `config/model-pricing.json`、`config/model-tokenizer.json` | **存储根**下 `config/`（默认 `./config/`，可随 `GINKGO_HOME` 外移）；仓库不预置，属可选配置 |
>
> 背景：`docs/llm-harness-hardening-plan.md`（v1.0）的 WS-1~6 已全部落地（结构化遥测、看门狗、
> 预算熔断、结构化交接、模型面防御、双层 eval），WS-7 留了接口设计未实施。当前评审结论：
> 单进程形态已成熟，本方案目标——**向市场成熟框架（LiteLLM Router / Langfuse / LangGraph
> checkpointer / OTel 体系）看齐，并支持多副本水平扩展**。接续编号 WS-8~13。
>
> 原则（沿用 v1.0）：**全部改动向后兼容**——新能力均为可选注入，缺省（内存态）行为与现状
> 逐字节等价；不破坏既有测试锁定的语义；遵循仓库「数据源/配置零硬编码」约束。

---

## 总览：六个工作流与实施顺序

| # | 工作流 | 对应缺口 | 对标 | 建议顺序 | 工作量 | 依赖 |
|---|---|---|---|---|---|---|
| WS-9 | Provider 韧性层（重试/退避/fallback 链） | 模型请求无重试无降级 | LiteLLM Router | **第 1** | 3-4 天 | 无 |
| WS-10 | 认证与多租户接缝 | 包内零鉴权，跨租户流可重接 | 通用 API 网关 | 第 2 | 2-3 天 | 无 |
| WS-8 | StreamHub 状态外置 + **Redis 多副本后端** | 单进程内存态 | LangGraph checkpointer | 第 3 | 接口+内存搬迁 2 天 / Redis 后端 5-7 天 | WS-10（租户键） |
| WS-11 | 成本台账与配额（含分布式实现） | token 计量只有事件没有账 | LiteLLM budgets / Langfuse cost | 第 4 | 3-4 天 | WS-10；多副本形态依赖 WS-8 的 Redis 基建 |
| WS-12 | 计量精化（可注入 tokenizer） | 纯启发式估算 | tiktoken 系 | 第 5（小，可随时插入） | 1 天 | 无 |
| WS-13 | 可观测性出口 + eval 常态化 | 事件止于 NDJSON console | OTel / Prometheus / Langfuse | 第 6 | 3-4 天 | WS-11（成本指标同源） |

> 排序理由：WS-9 与进程拓扑无关、用户可感知收益最大，先做；WS-10 的租户键是 WS-8 存储键
> 与 WS-11 配额维度的共同前缀，必须在其后；WS-8 是多副本目标的主战场，含完整 Redis 后端；
> WS-11 复用 WS-8 引入的 Redis 连接与键规约；WS-12/13 收尾。

---

## 多副本目标架构（WS-8/WS-11 的共用底座）

```text
                ┌────────────── LB（无粘性要求）──────────────┐
                │                                             │
        ┌───────▼───────┐                             ┌───────▼───────┐
        │  Next 实例 A  │                             │  Next 实例 B  │
        │  owner: 任务X │                             │  owner: 任务Y │
        │  reader 循环  │                             │               │
        └───────┬───────┘                             └───────┬───────┘
                │                                             │
        ┌───────▼─────────────────────────────────────────────▼───────┐
        │                          Redis                              │
        │  task:{key} (hash)    task:{key}:chunks (list+TTL)          │
        │  chan:{key} (pub/sub 分块)   control:{key} (pub/sub abort)  │
        │  lease:{key} (TTL 心跳)      running (set, 分布式准入计数)   │
        │  ledger:{tenant} (zset, 配额/台账)                          │
        └─────────────────────────────────────────────────────────────┘
```

**核心语义**：
- **owner 模型**：创建任务的实例持有 provider reader 循环、abortController、看门狗；
  分块一边推本地订阅者一边写 Redis（list 追加 + channel 发布）。
- **任一副本可服务重连**：客户端带 sessionId 落到任何实例 → 从 list 重放历史分块 →
  subscribe channel 续接 live 分块。**LB 不需要粘性会话**。
- **跨副本 abort**：任何实例收到 stop → publish control → owner 实例监听后
  触发本地 abortController + cancel 上游 reader（止血语义与单机一致）。
- **租约与孤儿回收**：owner 每 5s 刷新 `lease:{key}`（TTL 15s）；任何实例的
  清扫器（带抖动间隔 + SET NX 抢锁）发现 running 任务租约失踪 → 诚实标记
  `error: owner_lost` 并广播关闭订阅者。**不重连接管**（provider 流已死，假装可续是欺骗）。
- **分布式准入**：`running` set 计数替代进程内 `runningCount()`；
  清扫器同步剔除租约失踪的成员，计数允许近似（准入本就是软约束）。

---

## 任务 9：WS-9 Provider 韧性层（第 1 优先）

### 目标

模型请求失败（429/5xx/网络抖动）从「直接流式报错给客户端」升级为
「指数退避重试 → 换 fallback 模型 → 仍失败才报错」，对标 LiteLLM Router 的
`num_retries + fallbacks` 语义。

### 设计

**新建 `packages/ginkgo-llm/src/resilience.ts`**：

```ts
/** 错误分类：决定重试与 fallback 策略 */
export type ProviderErrorClass =
  | "auth"            // 401/403 — 不重试不 fallback（凭证问题，重试无意义）
  | "bad_request"     // 400/404/422 — 不重试不 fallback（请求本身非法）
  | "context_overflow"// 400 且 message 含 context length — 不重试；可 fallback 到更大窗模型
  | "rate_limit"      // 429 — 重试（读 Retry-After）→ 用尽后 fallback
  | "server"          // 500/502/503/529 overloaded — 重试 → fallback
  | "network"         // fetch reject / SSE 首字节前连接中断 — 重试 → fallback
  | "unknown";

export interface ModelSpec {
  model: string;
  apiKey?: string;      // 缺省沿用主请求凭证
  baseURL?: string;     // 缺省沿用主请求 baseURL
  protocol?: "openai" | "anthropic";  // 缺省沿用主请求协议
}

export interface ResiliencePolicy {
  /** 单模型最大重试次数（不含首次），缺省 2；钳 0–5 */
  maxRetries?: number;
  /** 退避基数 ms，缺省 1000；实际等待 = base * 2^n + jitter(0–500ms) */
  backoffBaseMs?: number;
  /** 单次 HTTP 请求超时（首字节前），缺省 60s；钳 5s–300s */
  requestTimeoutMs?: number;
  /** 失败切换的候选模型链，按序尝试；缺省空（不 fallback） */
  fallbacks?: ModelSpec[];
}
```

**重试边界（与 LiteLLM 一致的诚实语义）**：
- 只重试「流产出第一个 content 分块之前」的失败。流已开始吐字后失败，
  不做透明重跑（客户端已见部分内容，重跑会重复输出）——按现状 onError 路径报错，
  但发遥测 `MID_STREAM_FAILURE`。
- `createReasoningFetch` 之上再包一层 `createResilientFetch(baseFetch, policy, hooks)`：
  `response.ok === false` 或 fetch reject 时按分类退避重试；
  尊重 `Retry-After` 头（秒数或 HTTP-date，钳 0–60s）。
- **fallback 不在 fetch 层而在 handler 层**：主模型重试用尽后，用下一个 ModelSpec
  重建 `languageModel` 并重发整个 `streamText`（前提仍是未产出任何 content 分块）；
  切换时向客户端写 `data` 分块 `{ type: "model_fallback", from, to, reason }`；
  遥测 `warn code=MODEL_FALLBACK`。

**配置来源**（零硬编码，三层回退）：
请求体新增 `resilience?: ResiliencePolicy` ＞
环境变量 `LLM_FALLBACK_MODELS`（JSON 数组）、`LLM_MAX_RETRIES`、`LLM_REQUEST_TIMEOUT_MS` ＞ 缺省。
fallback 中的裸 apiKey 沿用 CRED_GUARD 原则：不允许 fallback 把环境凭证带到请求体未授权的 URL。

**多副本备注**：重试/fallback 发生在 owner 实例内，对 Redis 层透明，无额外分布式问题。

### 文件级改动

- 创建 `packages/ginkgo-llm/src/resilience.ts` + `resilience.test.ts`
- 修改 `packages/ginkgo-llm/src/handler.ts`：模型构建段改为模型链循环；
  `AnalyzeRequestBody` 增 `resilience` 字段；遥测增 `MID_STREAM_FAILURE`/`MODEL_FALLBACK` code
- 修改 `packages/ginkgo-llm/src/handler.test.ts`

### 任务拆解

- [ ] **9.1 错误分类器**：`classifyProviderError(err | Response): ProviderErrorClass`。
  验收：401/400/400-context-length/429/500/ECONNREFUSED 六类输入各返回正确分类；429 解析 Retry-After。
- [ ] **9.2 resilientFetch**：退避重试 + 首字节超时。验收：mock fetch 先两次 500 后 200，
  断言调用 3 次；429 带 Retry-After: 2 时等待 ≥2s（fake timers）。
- [ ] **9.3 handler 模型链**：验收：主模型 503 用尽重试后 fallback 成功，客户端流含
  `model_fallback` 分块；fallback 也失败则 onError；首分块后失败不重跑。
- [ ] **9.4 配置解析与凭证护栏**：验收：fallback 指向新 baseURL 但无对应 key 时 400。

---

## 任务 10：WS-10 认证与多租户接缝（第 2 优先）

### 目标

包从「假设上游已鉴权」升级为「标准鉴权接缝 + 租户隔离」，并修复现存安全缺陷：
**当前任何知道 sessionId 的客户端都能 reconnect/GET 探测别人的在途流**。
租户键同时成为 WS-8 存储键与 WS-11 配额维度的前缀。

### 设计

**`AnalyzeHandlerOptions` 新增**：

```ts
export interface AuthContext {
  /** 调用方标识（API key id / user id），必填 */
  principal: string;
  /** 租户隔离命名空间；缺省 = principal */
  tenantId?: string;
  /** 供配额/审计透传的自定义声明（如 allowEnvCredentials） */
  claims?: Record<string, unknown>;
}

export interface AnalyzeHandlerOptions {
  // ……既有字段
  /**
   * 鉴权钩子（可选注入）：返回 null/undefined 即 401。
   * 不注入时保持现状（包不鉴权）——所有请求视为同一匿名租户 "anon"，
   * 行为与今天完全一致。
   */
  authenticate?: (req: Request) => Promise<AuthContext | null>;
}
```

**租户隔离（默认生效，不依赖是否注入 authenticate）**：
- 存储键从 `sessionId` 改为 `${tenantId}:${sessionId}`（tenantId 缺省 `"anon"`）；
  该 sessionKey 贯穿 hub 内存 Map、Redis 键、遥测事件三处，**单点生成、全程透传**。
- reconnect 与 `action=stop` 必须同租户才命中任务；跨租户按无任务处理。
- 应用层 `GET /api/analyze` 探测路由同步适配。

**凭证解析收紧**：`claims.allowEnvCredentials === false` 时仅用请求体凭证
（多租户 SaaS 形态下环境凭证属于平台，不被租户借用）。

### 文件级改动

- 修改 `packages/ginkgo-llm/src/streamHub.ts`：键命名空间化（方法签名加可选 tenantId，缺省 "anon"）
- 修改 `packages/ginkgo-llm/src/handler.ts`：authenticate 调用点、401 响应、sessionKey 生成与透传
- 修改 `src/app/api/analyze/route.ts`：注入应用侧 authenticate（无认证体系时先注入开发模式桩）
- 创建 `packages/ginkgo-llm/src/auth.test.ts`

### 任务拆解

- [ ] **10.1 hub 命名空间化**：验收：既有 streamHub 测试**不改断言全绿**；
  新增「同 sessionId 不同租户互不命中」用例。
- [ ] **10.2 authenticate 钩子与 401**：验收：null → 401；AuthContext → run_start 带 principal；
  未注入钩子 → 现状一致。
- [ ] **10.3 跨租户重接防护**：验收：租户 B 带 A 的 sessionId reconnect/stop 均不命中。
- [ ] **10.4 env 凭证借用开关**：`allowEnvCredentials=false` 且无请求体 key → NO_API_KEY 降级流。

---

## 任务 8：WS-8 StreamHub 状态外置 + Redis 多副本后端（第 3 优先，**核心交付**）

### 目标

落地 v1.0 WS-7 并一次到位：**hub 与存储解耦 + Redis 后端 + 分布式准入 + 跨副本 abort
+ 孤儿任务回收**，使任意副本可服务任何会话的重连，LB 无需粘性。

### 设计

**新建 `packages/ginkgo-llm/src/taskStore.ts`**（接口与内存实现）：

```ts
export type TaskStatus = "running" | "completed" | "error";

export interface TaskSnapshot {
  sessionKey: string;          // 已含租户前缀（WS-10）
  runId?: string;
  ownerInstanceId: string;     // 创建任务的实例（孤儿回收判定用）
  status: TaskStatus;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStore {
  create(snapshot: TaskSnapshot): Promise<void>;
  appendChunk(sessionKey: string, chunk: Uint8Array): Promise<void>;
  setStatus(sessionKey: string, status: TaskStatus, errorMessage?: string): Promise<void>;
  get(sessionKey: string): Promise<TaskSnapshot | undefined>;
  getChunks(sessionKey: string): Promise<Uint8Array[]>;
  delete(sessionKey: string): Promise<void>;
  /** 分布式准入计数 */
  runningCount(): Promise<number>;
  /** live 分块订阅（重连续接）与 abort 广播；内存实现为进程内 EventEmitter */
  subscribeChunks(sessionKey: string, onChunk: (c: Uint8Array) => void): () => void;
  publishAbort(sessionKey: string, reason: AbortReason): Promise<void>;
  subscribeAbort(onAbort: (sessionKey: string, reason: AbortReason) => void): () => void;
  /** 租约（多副本实现必须；内存实现可为 no-op） */
  refreshLease?(sessionKey: string, ownerInstanceId: string, ttlMs: number): Promise<void>;
  /** 清扫器：回收租约失踪的 running 任务（多副本实现必须） */
  sweepOrphans?(isAlive: (ownerInstanceId: string, sessionKey: string) => Promise<boolean>): Promise<string[]>;
}
```

**三个实现**：

1. **`InMemoryTaskStore`（缺省）**：现有 Map 逻辑原样搬入 + 进程内 EventEmitter 实现
   subscribe/publish。**验收门禁：既有 streamHub.test.ts 不改断言全绿。**
2. **`FileTaskStore`**： `${LLM_TASK_STORE_DIR}/<sessionKey>.ndjson`（首行元数据，
   后续每行 base64 chunk）；进程重启恢复 completed/error 任务供重放；
   running 任务标记 `error: process_restart`（诚实语义）。面向单机但需重启不丢的形态。
3. **`RedisTaskStore`（多副本核心）**：依赖 `ioredis`（**peer optional + 动态 import**，
   单进程部署不安装不受影响）。键规约：
   - `harness:task:{sessionKey}` hash——snapshot 元数据
   - `harness:task:{sessionKey}:chunks` list——base64 chunk，TTL 10min（running 由心跳续期，终态 30s 后删）
   - `harness:chan:{sessionKey}` pub/sub——live 分块
   - `harness:control` pub/sub（单频道）——abort 广播
   - `harness:lease:{sessionKey}` string TTL 15s——owner instanceId，心跳 5s 刷新
   - `harness:running` set——分布式准入计数（create 时 SADD，终态 SREM，清扫器对账）

**hub 改造（`SessionStreamHub`）**：
- 构造接受 `store?: TaskStore` + `instanceId?: string`（缺省 `hostname:pid`）。
- 本地 Map 只存 owner 侧运行时对象（abortController/subscribers/reader）——
  这部分**本质上是进程内的，不进存储**；共享状态全部走 TaskStore。
- `createResponse`（重连路径）改为：本地是 owner → 现状直推；非 owner →
  `getChunks` 重放 + `subscribeChunks` 续接。
- `abortTask`：本地是 owner → 现状路径 + `publishAbort`；非 owner → 仅 `publishAbort`，
  owner 实例经 `subscribeAbort` 收到后执行本地 abort（含 cancel 上游 reader 止血）。
- `runningCount()` 改 async，委托 store；handler 并发准入点适配。
- 心跳：owner 注册任务时启动 5s 定时器 `refreshLease`，终态清除（与看门狗同生命周期）。
- 清扫器：每 30s±10s 抖动跑一次 `sweepOrphans`；回收动作 = setStatus(error, "owner_lost")
  + publish 关闭。多实例同时扫是幂等的（重复标记同结果）。

**handler/route 适配**：读路径全 async 化（`hasTask`/`isSessionRunning`/`getTask`/`runningCount`，
约 5 处调用点）；`createAnalyzeHandler` 增 `taskStore`、`instanceId` 选项。

### 文件级改动

- 创建 `taskStore.ts`（接口 + InMemory）、`fileTaskStore.ts`、`redisTaskStore.ts`
- 修改 `streamHub.ts`（owner/非 owner 双路径、心跳、清扫器、abort 桥接）
- 修改 `handler.ts`、`src/app/api/analyze/route.ts`（async 读路径）
- 创建 `taskStore.test.ts`、`redisTaskStore.test.ts`（**testcontainers 或 fakeredis 二选一**，
  倾向 `ioredis-mock`：CI 不起容器，协议面覆盖足够；真实 Redis 验证留给 docker-compose 手动场景）
- 创建 `docker-compose.yml`（仓库根，redis 服务，供多副本手动验证）
- 文档：`docs/llm-harness-multi-instance.md`（部署拓扑、env、运维手册）

### 任务拆解

- [ ] **8.1 TaskStore 接口 + InMemory 搬迁**：验收：既有 streamHub 测试全绿不改断言。
- [ ] **8.2 hub 读路径 async 化 + 调用点适配**：验收：typecheck 通过；全仓 grep
  `hasTask|isSessionRunning|getTask|runningCount` 无遗漏；既有 handler 测试全绿。
- [ ] **8.3 FileTaskStore**：验收：3 个 chunk 后 kill 进程重启，completed 任务可重放；
  running 任务重连收到 error 语义；终态 30s 清理。
- [ ] **8.4 RedisTaskStore 基础读写**：验收（ioredis-mock）：create/appendChunk/get/setStatus/
  delete/runningCount 与内存实现行为一致（同一测试套件跑两个实现——**实现间契约测试**）。
- [ ] **8.5 跨副本重连续接**：验收：模拟两实例（两个 hub + 同一 store），A 创建任务产出
  5 个分块，B 的 createResponse 重放 5 个并经 subscribeChunks 收到第 6 个 live 分块。
- [ ] **8.6 跨副本 abort**：验收：B 调 abortTask → A 的本地 abortController 触发、
  上游 reader 被 cancel、任务终态为 error。
- [ ] **8.7 租约与孤儿回收**：验收：A 创建 running 任务后「暴毙」（不清理地销毁），
  租约过期后 B 的清扫器将其标记 owner_lost；重连收到 error 语义。
- [ ] **8.8 分布式准入**：验收：`running` set 计数驱动 429；owner 暴毙的任务被清扫器
  从计数剔除，准入名额自动释放。
- [ ] **8.9 部署文档 + docker-compose 手动验证脚本**。

### 测试策略

契约测试为核心：**同一套件参数化跑 InMemory/File/Redis(mock) 三个实现**，
保证行为一致；hub 层用双实例用例覆盖 8.5–8.8。CI 不起真实 Redis（ioredis-mock），
真实拓扑由 8.9 的手动验证清单兜底。

---

## 任务 11：WS-11 成本台账与配额（含分布式实现）（第 4 优先）

### 目标

token 计量从「事件流里的数字」升级为「可持久化、可查询、可准入拦截的账」，
多副本形态下配额判定必须跨实例一致。

### 设计

**新建 `packages/ginkgo-llm/src/costLedger.ts`**：

```ts
export interface UsageRecord {
  runId: string;
  tenantId: string;         // WS-10；无鉴权时 "anon"
  sessionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 单价表命中时计算；缺单价则 undefined（只记量不记钱） */
  costUsd?: number;
  finishedAt: number;
}

export interface CostLedger {
  record(entry: UsageRecord): Promise<void>;
  /** 窗口期累计（配额判定用）；windowMs 滚动窗 */
  sumUsage(tenantId: string, windowMs: number): Promise<{ tokens: number; costUsd: number }>;
}

export interface QuotaPolicy {
  /** 每租户滚动窗 token 上限；超限 429 */
  tenantTokenLimit?: number;
  windowMs?: number;        // 缺省 24h
}
```

- **三个实现**：`InMemoryCostLedger`（缺省）、`NdjsonCostLedger`（append-only 文件，
  单机持久）、**`RedisCostLedger`**（`harness:ledger:{tenant}` zset，member=runId、
  score=finishedAt，`ZRANGEBYSCORE` 聚合滚动窗；与 WS-8 共用 Redis 连接与 keyPrefix）。
  多副本部署必须注入 Redis 实现——配额用进程内实现等于每实例一份额度，语义错误，
  文档中显式标注。
- **计价表**：`config/model-pricing.json`（用户维护，零硬编码；USD / 1M tokens，
  前缀匹配同 context.ts 窗口表），热加载沿用 `CertifiedQueryStore.reloadIfChanged` 模式。
- **写入点**：handler `onFinish`（task_finish 处）；**准入点**：`QuotaPolicy` 存在且
  超限 → 429 + 遥测 `warn code=QUOTA_EXCEEDED`。与既有 `LLM_TASK_TOKEN_BUDGET` 正交：
  一个管单次敞口、一个管租户累计。
- **应用层出口**：`GET /api/usage?tenant=`（app 侧薄路由）。

### 文件级改动

- 创建 `costLedger.ts`（接口 + InMemory + Ndjson + Redis 实现）+ `costLedger.test.ts`
- 修改 `handler.ts`：`AnalyzeHandlerOptions` 增 `costLedger`、`quota`
- 创建 `config/model-pricing.json`（示例）、`src/app/api/usage/route.ts`

### 任务拆解

- [ ] **11.1 三实现契约测试**：record 100 条后 sumUsage 窗口聚合一致；Ndjson/Redis
  重启（重建连接）后结果一致。
- [ ] **11.2 计价表加载与前缀匹配 + 热加载**：命中算 costUsd；未命中 undefined。
- [ ] **11.3 onFinish 入账**：台账记录与 task_finish 遥测事件口径一致（SDK 累计值）。
- [ ] **11.4 配额准入**：超限 429；换租户互不影响；**多副本场景**（Redis 实现 +
  双 hub）A 实例产生的用量对 B 实例的准入可见；无配置零拦截。

---

## 任务 12：WS-12 计量精化（第 5 优先）

### 目标

投影阈值判定从纯启发式升级为可注入真实 tokenizer，降低「压无可压交给模型端报错」的尾部概率。

### 设计

```ts
/** AnalyzeHandlerOptions 新增（可选注入） */
tokenizer?: { encode(text: string): number };
```

- 缺省 = 现有 `estimateTextTokens`（CJK 启发式），行为不变。
- `createTiktokenEstimator(encoding?)`：**动态 `import("js-tiktoken")`**（peer optional）；
  未安装回退启发式并 warn 一次。
- 只影响 `projectMessages` 预判定；`usage.promptTokens` 实测锚点仍是最高优先级（机制不动）。
- 模型→encoding 映射走 `config/model-tokenizer.json`（用户维护），缺省 `cl100k_base` 近似。

### 任务拆解

- [ ] **12.1 Tokenizer 接缝 + 缺省回退**：验收：stub tokenizer 注入后 estimated 按 stub 计算；
  不注入时既有 context.test.ts 15 用例全绿。
- [ ] **12.2 js-tiktoken 可选工厂**：验收：未安装 warn 一次回退；安装后固定样本估算
  与官方值误差 <5%。

---

## 任务 13：WS-13 可观测性出口 + eval 常态化（第 6 优先）

### 目标

WS-1 的事件流接标准出口；WS-6 的 Tier B 升级为常态化基线对比。多副本形态下
观测出口是排障前提（事件分散在 N 个实例的 stdout 里无法 grep）。

### 设计

**A. OTel sink 适配器**：`packages/ginkgo-llm/src/otelSink.ts`——`createOtelSink(tracer)`
映射 span 树（run_start → span，step_finish/tool_result → 子 span，task_finish → 结束），
`@opentelemetry/api` 仅 peer optional。app 侧 `compositeSink(consoleSink, otelSink)` 接入。
span attribute 带 `instance.id`（WS-8 的 instanceId），多副本事件可区分来源。

**B. Prometheus 指标出口（app 层）**：`src/app/api/metrics/route.ts`——进程内聚合 sink
（计数器/直方图/gauge，文本格式）。**单实例自刷/Prometheus pull 模型天然多副本兼容**
（每实例一个 target，按 instance label 聚合）；文档标注多副本优先 OTel push 路径。

**C. Tier B 常态化**：`pnpm eval:tier-b` 接 CI `workflow_dispatch` + 每周 schedule；
基线 `evals/baselines/<model>.json` 存四指标，diff 超阈值（终态合规率降 >5pt）CI 红；
`LLM_TIER_B_BUDGET` 成本闸门。

### 任务拆解

- [ ] **13.1 otelSink 映射**：验收：fake tracer 收到正确 span 层级；attribute 含 instance.id。
- [ ] **13.2 聚合 sink + /api/metrics**：验收：指标文本可被 Prometheus parser 解析；
  既有事件无一遗漏。
- [ ] **13.3 Tier B CI + 基线 diff**：验收：手工触发产出对比报告；注入回归时 CI 红。

---

## 环境变量增量（全部可选，带缺省）

| 变量 | 缺省 | 归属 |
|---|---|---|
| `LLM_MAX_RETRIES` | 2（钳 0–5） | WS-9 |
| `LLM_REQUEST_TIMEOUT_MS` | 60000（钳 5s–300s） | WS-9 |
| `LLM_FALLBACK_MODELS` | 空（JSON 数组） | WS-9 |
| `LLM_TASK_STORE` | `memory`（`file` / `redis`） | WS-8 |
| `LLM_TASK_STORE_DIR` | `data/stream-tasks` | WS-8 |
| `REDIS_URL` | 无（redis 模式必填） | WS-8 |
| `LLM_INSTANCE_ID` | `hostname:pid` | WS-8 |
| `LLM_LEASE_TTL_MS` | 15000 | WS-8 |
| `LLM_SWEEP_INTERVAL_MS` | 30000（±10s 抖动） | WS-8 |
| `LLM_TENANT_TOKEN_LIMIT` | 无（不启用配额） | WS-11 |
| `LLM_QUOTA_WINDOW_MS` | 86400000 | WS-11 |
| `LLM_TOKENIZER` | `heuristic`（`tiktoken`） | WS-12 |
| `LLM_TIER_B_BUDGET` | 2000000 | WS-13 |

## 兼容性承诺

1. `AnalyzeHandlerOptions` / `AnalyzeRequestBody` 仅增可选字段；`LLM_TASK_STORE` 缺省
   `memory` 时行为与现状逐字节等价——**每个 WS 的合入门禁 = 全量 `pnpm test` + `pnpm typecheck` 绿**。
2. hub 读路径（`hasTask`/`isSessionRunning`/`getTask`/`runningCount`）改 async 是
   **唯一破坏性变更**，影响面 = `route.ts` 一处；包为 private workspace 包，无外部消费者。
3. prompt 零改动；WS-9 的 fallback 路径在 Tier B 补「主模型故障注入」场景。
4. 遥测事件新增可选字段（tenantId / instanceId），NDJSON 下游解析兼容。
5. `ioredis`、`js-tiktoken`、`@opentelemetry/api` 全部 peer optional + 动态 import：
   单进程部署不安装任何新依赖即可运行。

## 验收标准（逐 WS）

1. **WS-9**：mock 注入 429×3 → 500 → 200，客户端无感成功且遥测记录重试；主模型永久 503
   自动切换 fallback 并告知客户端；首分块后失败绝不重跑。
2. **WS-10**：注入 authenticate 后无凭证 401；跨租户 reconnect/stop 互不命中；不注入时全量既有测试绿。
3. **WS-8**：三实现契约测试同套件全绿；双实例用例证明：跨副本重放+续接、跨副本 abort 止血、
   owner 暴毙后孤儿任务被诚实标记、分布式准入计数自动对账；`docker-compose` 双副本手动验证清单通过。
4. **WS-11**：台账与遥测口径一致；Redis 实现下 A 实例用量对 B 实例准入可见；无配置零拦截。
5. **WS-12**：真实 tokenizer 估算误差 <5%；缺省路径既有测试全绿。
6. **WS-13**：OTel span 树正确且含 instance.id；/api/metrics 可解析；Tier B 基线回归被 CI 拦截。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| WS-9 fallback 重放整轮 = 数据源工具重跑（副作用放大） | 中 | 仅限首 content 分块前；工具多为只读查询 |
| Redis pub/sub 不持久——重连瞬间的 live 分块可能丢（订阅建立前的间隙） | 中 | 重连协议 = 先 subscribe 再读 list 重放，按 chunk 序号去重；或接受间隙内分块等下一次重放（文档注明取舍） |
| 分布式准入计数与真实任务漂移（SREM 漏跑） | 中 | 清扫器周期对账（running set ∩ 租约）；准入本就是软约束 |
| hub 读路径 async 化漏改调用点 | 中 | typecheck 门禁 + 全仓 grep 清单核对 |
| ioredis-mock 与真实 Redis 行为差异（Lua/阻塞命令） | 中 | 实现只用基础命令（hash/list/set/zset/pubsub/TTL），不用 Lua；真实拓扑手动验证清单兜底 |
| 多副本下会话元数据（sessionStore，应用层文件存储）仍是单点 | **高** | **本方案明确覆盖**：WS-8 文档要求多副本部署时应用层 sessionStore 同步换共享存储（给出接口适配说明）；这是部署手册的强制条目而非可选项 |
| Tier B CI 成本失控 | 低 | 预算 env 钳制 + 仅 schedule/dispatch 触发 |

## 不做清单（YAGNI 边界）

- 不做通用 chat completion 代理（非 OpenAI 兼容网关定位）
- 不做 prompt 管理/版本化平台（Langfuse prompt 域）
- 不做模型负载均衡/加权路由（LiteLLM 域，fallback 链已覆盖主故障场景）
- 不做请求级 response cache（分析场景命中率低）
- 不做 etcd/Consul 强一致协调（Redis 租约 + 幂等清扫足够）
- 不做 running 任务的跨副本接管迁移（provider 流不可迁移，诚实标记 owner_lost 即可）
