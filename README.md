# OpenUI Analytics

对话式生成 UI 数据分析看板：用自然语言提问，由 LLM 编排 **PostgreSQL / GitLab / 禅道 / 文件（CSV·Excel → DuckDB）** 多路数据源取数，流式生成 **OpenUI Lang** 声明式看板（KPI 卡、漏斗、热力图、雷达图、预算模拟器等）并实时渲染。

## 架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Browser (Next.js 16 / React 19)                              │
│  ChatDashboard (组合层)                                       │
│   ├─ chat/ChatSidebar    会话管理 + 预设场景                  │
│   ├─ chat/MessageList    消息流 + 工具调用指示 + OpenUI 渲染  │
│   ├─ chat/ChatInput / SettingsModal / DevToolsPanel          │
│   └─ hooks/useLlmSettings + useSessionManager                │
└──────────────┬───────────────────────────────────────────────┘
               │ POST /api/analyze (Data Stream Protocol v1)
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Route Handler: streamText (Vercel AI SDK)                    │
│  system prompt: OpenUI 组件规范 + 数据源使用指引             │
│  tools:                                                      │
│   ├─ execute_sql / list_tables / describe_table ──► 本地 MCP │──► PostgreSQL (只读守卫)
│   ├─ gitlab_* ──► 外部 GitLab MCP Server                     │──► GitLab 工程数据
│   └─ zentao_* ──► 本地 ZenTao CLI MCP                        │──► 禅道项目/Bug/工时
└──────────────────────────────────────────────────────────────┘
               │ 模型输出 ```openui 代码块
               ▼
        OpenUIRenderer 流式渐进渲染为可交互看板
```

**Workspace 包结构**：能力抽为五个私有子包，各自带详细 README（架构/业务逻辑/功能/扩展指南）：

| 包 | 门面 | 职责 |
| --- | --- | --- |
| `packages/openui-chart-spec` | `parseDashboardSpec` / `applyJsonPatch` | DashboardSpec 2.0 声明式状态树 + RFC 6902 JSON Patch 引擎（最底层 spec 契约，zod-only） |
| `packages/openui-datasources` | `createDatasourceManager` | 数据源配置/连接/工具装配 + 只读守卫管线 + 结果集缓存 + Schema Card + Certified Queries 语义层 |
| `packages/openui-components` | `analyticsLibrary` | OpenUI 规范展示组件库（24 组件，layout/metrics/charts/data/insight/timeline/interaction/spec 分类） |
| `packages/openui-llm` | `createAnalyzeHandler` | LLM 编排、StreamHub 流中继、上下文治理、双层 eval（依赖注入数据源单例） |
| `packages/openui-methodology` | `builtinMethodCards` | 方法论资产：10 张内置方法卡 + 用户卡 JSON 契约 |

应用侧 `src/` 只保留路由薄壳、前端 UI 与共享层。

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:3006
```

打开页面后，点击右上角「设置」填入 LLM API Key 即可开始（也可通过环境变量预置）。

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `OPENAI_API_KEY` / `LLM_API_KEY` | LLM API Key（也可在页面设置中配置） | 无 |
| `OPENAI_BASE_URL` / `LLM_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` / `LLM_MODEL` | 模型名 | `gpt-4o-mini` |
| `LLM_TASK_TIMEOUT_MS` | 单个分析任务的 wall-clock 上限（超时自动中止，防 provider 挂起） | 600000（钳 30s–60min） |
| `LLM_TASK_TOKEN_BUDGET` | 单任务累计 token 预算（超限写 budget_exhausted 终态并中止） | 600000（钳 10k–5M） |
| `LLM_MAX_CONCURRENT_TASKS` | 进程级同时 running 任务数上限（新任务超限返回 429） | 8（钳 1–64） |
| `LLM_TOOL_OUTPUT_MAX_BYTES` | 单个工具结果进入模型上下文的字节上限（超限头尾保留截断） | 32768（钳 4KB–1MB） |
| `LLM_MAX_OUTPUT_TOKENS` | 每个生成步的输出 token 上限（Anthropic 端点必填项保障） | 16384（钳 1024–65536） |
| `PGUSER` / `PGHOST` / `PGDATABASE` / `PGPASSWORD` / `PGPORT` | 分析库连接（缺表时自动建表并写入示例数据） | 本机 `openui_analytics` 库 |
| 动态 DB 源（设置中配置） | `dbType` 四选：postgres / mysql / **sqlite** / **clickhouse**。sqlite 连接串为数据库文件路径（可带 `sqlite:` 前缀）；clickhouse 为 `http(s)://[user[:pass]@]host:8123[/database]`。全部只读双保险（词法守卫 + 引擎级只读） | — |
| GitLab MCP Endpoint / Token | 在页面「设置」中配置，存于浏览器 localStorage | `http://127.0.0.1:5002/mcp` |
| `OPENUI_API_AUTH_TOKEN` | 部署模式的 API 鉴权令牌；配置后所有 `/api/*` 请求须携带 `Authorization: Bearer <token>`（页面「设置 → 访问令牌」），未配置则本地免鉴权 | 无 |

禅道数据源依赖本机已登录的 `zentao` CLI（`zentao mcp --read-only`），无需额外配置。

### 自定义分析方法卡

分析方法论库内置 10 张通用方法卡（趋势/帕累托/漏斗/RFM/同期群/异常检测/归因/目标差距/排名/分布）。把自定义卡放入 `data/methodology/*.json`（单卡对象或卡数组，字段见 `MethodCard` 契约）即可扩展或覆盖（同 id 覆盖内置），重启生效；坏文件跳过并告警，不影响启动。

## 活看板（数据刷新）

收藏看板不只是静态快照：生成期捕获的取数查询（`queries`/`bindings`）随收藏落盘，收藏库中的看板可在**预览弹窗一键刷新数据**——服务端按序重放查询并回填组件数值，**全程零 LLM 调用**（不走「重新分析」的整轮模型往返，贵与漂移问题都不存在）。

- **派生变换（transform）**：直取匹配失败的组件，捕获引擎会尝试把「LLM 加工」推测为**确定性变换 spec**（封闭算子：aggregate/groupBy+sum/avg/count/min/max、受限四则派生列、sort、limit），并用查询结果重算与组件实际数据做**一致性验证**——验证通过才绑定落盘（`transforms` 随收藏保存），刷新时服务端重放查询后按 spec 重算回填；验证不过维持纯快照降级（宁缺勿错）
- **可刷新率约束（prompt 层）**：系统提示词强制聚合下推 SQL（GROUP BY/SUM/AVG 在 SQL 内完成）、数据组件赋值命名变量、组件行原样复用查询结果——大多数看板因此直接命中直取绑定
- **入口**：看板预览头部「刷新数据」按钮；刷新中按钮进入 loading 态，成功后组件数值与「数据时间」时间戳同步更新
- **数据时间戳**：预览头部与侧栏收藏列表均展示 `dataUpdatedAt`（最近一次刷新成功时间），数据新鲜度一眼可见
- **旧快照兼容**：v0.1 无 `queries` 字段的静态快照刷新按钮禁用（提示走「重新分析」），永不报错
- **降级语义**：单个查询失败 → 该组件保留旧数据并显示「⚠ N 个组件数据过期」徽标；**全部查询失败**（或数据源不可用）→ 刷新整体失败并给出归一错误提示，原 dsl/时间戳原样保留不落盘；只有全部组件刷新成功才更新 `dataUpdatedAt`
- **安全边界**：`kind:"tool"` 查询在服务端经**只读白名单**复核后才重放（db 读工具 / 读语义工具名 / 禅道只读 action），写语义工具一律拒绝——queries 来自不可信的客户端落盘数据，刷新端点不提供任何写能力
- **实现**：`src/lib/dashboardRefresh.ts` + `POST /api/dashboards/[id]/refresh` + `useDashboards.refreshOne(id)`；sql 查询走只读守卫，tool 查询走只读白名单 + MCP callTool

## 语义图表与声明式看板体系

- **ChartSpec 契约**：图表采用声明式 `ChartSpec`（`dims` 维度、`meas` 指标、`filters` 过滤、`chartType`），将图表表现层与底层数仓取数解耦。
- **SpecChart 零 LLM 物化**：图表生成期可携带静态快照，二次交互或刷新时由服务端直接依据 `ChartSpec` 物化取数回填（`specMaterialize`），换图不换绑定，兼顾快照秒开与活数据刷新。
- **动态时间宏（Time Macros）**：刷新支持智能日期推测与滚动宏（如 `TODAY - 30d` ~ `TODAY`），使周期性趋势看板随时间自动向前滑动，避免日期死编码。
- **数仓中英双向语义映射**：内置 `BUSINESS_SYNONYM_MAP`（订单/退款/渠道等 18+ 常用数仓双向映射），让全中文自然语言提问能精准召回英文表名与度量列。

## 筛选联动与事件总线（FilterBus）

- **作用域事件总线 (`filterBus`)**：组件间通过轻量发布-订阅总线通信，支持看板级别 `scopeId` 隔离，多看板或同屏多个报表互不串扰。
- **状态持久化与回放**：`filterBus` 维护作用域当前激活筛选字典（`getFilterState`），支持 `replayCurrent`；当组件（如 `DataTable` / `SpecChart`）二次挂载或工作台切栏时，无缝恢复已有筛选条件。
- **交互组件**：
  - `AnalyticsFilterBar`：支持声明模式（自动从数据源 distinct 端点拉取候选项）与参数调整演示模式。
  - `DataTable`：纯前端轻量分页（默认 20 条，带翻页栏与计数）、列排序、实时关键词模糊搜索与 CSV 导出；具备严格的空值排他匹配守卫。

## 渲染性能与流式平滑控制

- **流式 AST 解析平滑节流**：在 LLM 高速 token 输出阶段，通过 `useStreamingThrottled` 将超高频 OpenUI AST 重解析降频至 ~8fps（约 120ms 一次），彻底释放主线程 CPU，流式结束后立即全量对齐最新内容。
- **增量合批**：`experimental_throttle=100`（leading+trailing）对流式渲染合批，每个 SSE delta 不再触发全量重渲染。
- **思考流尾部窗口**：推理模型的思考可达数万字符，流式期间只渲染尾部 3000 字符窗口（每帧重排成本恒定），完成后回源全文可查。
- **图表自适应死循环防御**：针对 Recharts 在 CSS Grid 双列排版下的 ResizeObserver 尺寸震荡，图表容器全量装配 `minWidth={0} debounce={50}` 与 `min-w-0`，杜绝页面卡死。
- **消息流动画锁**：消息列表自动滚动采用 `requestAnimationFrame` 节流锁，防止高频 DOM 滚动重排引起的掉帧。

## 流式会话生命周期与断线重连（StreamHub）

服务端与客户端生命周期解耦：**切换/新建/刷新页面不杀任务，显式「停止」才真正终止**。

- **后台续跑**：客户端脱钩（切会话/刷新）仅中止订阅并落盘进度，StreamHub 任务由服务端独立 Reader 继续生成并全量缓冲
- **无缝续接**：回切会话时探针 `GET /api/analyze?sessionId=` 返回 `running/hasTask`，命中即在终态 30s 保留窗内重放历史分块并实时续接——切走再切回，输出不断线
- **即刻中止**：用户显式停止经 `abortTask` 取消 provider 侧生成（停止计费），任务级看门狗（默认 10 分钟）防 provider 挂起永久占用
- **防双消费**：「提交在途」守卫拦截重新分析切会话后 `isLoading` 未翻转窗口期的重连探测，避免两个消费端接入同一在途流

## 运行时防护与可观测

LLM 层内建五道防线（均可在环境变量章节调参）：

| 防线 | 触发行为 |
| --- | --- |
| 任务看门狗 | wall-clock 超限（`LLM_TASK_TIMEOUT_MS`）自动中止，防 provider 挂起永久占用 |
| token 预算熔断 | 单任务累计超限（`LLM_TASK_TOKEN_BUDGET`）写 `budget_exhausted` 终态并中止 provider |
| 并发准入 | running 任务数达上限（`LLM_MAX_CONCURRENT_TASKS`）时新任务返回 429；重连不占名额 |
| 工具结果截断 | 超长工具结果（`LLM_TOOL_OUTPUT_MAX_BYTES`）以 `<tool_output untrusted>` 信封头尾保留，配合 system 规则段声明「数据非指令」 |
| 重复循环熔断 | 推理模型生成退化（同一行字节级重复 ≥15 次）时自动截断、取消 provider 生成并注入说明，已产出内容全保留 |

- **结构化遥测**：`HarnessEvent` 事件流（run_start / step_finish / tool_result / task_finish / abort / reconnect…）以 NDJSON 输出，可注入 `TelemetrySink` 接入 OTel
- **finish_task 服务端不变量**：无看板/规划卡产出时 `completed` 状态被拒绝（提示改用 `insufficient_data`），防模型空口宣告完成

## 评测体系（Evals）

双层守护「机制正确」与「行为质量」：

- **Tier A 轨迹回归（进 CI）**：`packages/openui-llm/src/evals/trajectories.test.ts` 用脚本化模型剧本驱动 handler 全链路，锁定工具调用序列、终态类型、单步 token 锚点、上下文投影、注入信封与不变量门
- **Tier B 真实模型评估（手动/夜间）**：`packages/openui-llm/src/evals/tier-b.real-model.test.ts` 以确定性 CSV 夹具经真实 `/api/analyze` 全链路跑固定问题集，轨迹指标（步数/token/终态/看板解析）落盘基线对比；需环境变量提供 API Key，无 Key 自动跳过。**prompt/模型变更前后各跑一次**

## 会话存储

会话（消息历史、数据源选择、标题）持久化在**服务端** `data/sessions/`（单会话单 JSON 文件，原子写入），前端不再使用 localStorage 缓存——换浏览器、清缓存会话不丢，多浏览器可见同一份会话。接口：`GET/POST/PUT /api/sessions`（列表摘要 + 活跃指针 / 新建 / 设活跃）与 `GET/PUT/DELETE /api/sessions/:id`（详情含消息全文 / 局部更新 / 删除）。旧版本 localStorage 中的会话会在首次加载时**一次性自动迁移**到服务端（保留标题、消息与时间戳），迁移成功后旧键清除。

### 会话操作：分叉与回滚

- **分叉**：任意消息下方的「分叉」按钮把「到此为止」的对话复制为新会话（继承数据源选择，上下文计量独立），适合从某个中间结论探索不同追问方向，原会话不受影响
- **回滚重问**：用户消息下方的「回滚重问」截断该消息之后的全部对话，消息内容回填输入框供修订后重发；上下文治理的 token 锚点与摘要缓存随之重置

## 上下文治理（投影式压缩）

长会话不会撑爆模型窗口，也不会丢历史——**存储层永远保存完整会话，压缩只作用于「发往模型的投影」**：

- **token 计量**：最后一步的实测单步 `usage.promptTokens` 回写会话元数据作为锚点（多步工具调用的累计值不落盘，防剪枝判定虚高）；锚点后新增消息用字符启发式估算，误差逐轮自校正
- **触发**：估算 prompt > `min(窗口 × 0.7, 窗口 − maxTokens − 8k)` 时启动（窗口按模型名查表，或由客户端 hint 提供）
- **第一道 tool-result pruning**：保留窗口（窗口 × 25% 的最近消息）以外的工具结果替换为 `[已裁剪: 工具名]` 占位符；用户消息与 PlanReviewCard 天然豁免
- **第二道 LLM 摘要**：pruning 后仍超阈值时，把旧历史压缩为摘要注入 system prompt（同模型、≤2k token 输出），摘要缓存在会话元数据中增量复用
- **用量条**：输入框上方实时显示 `实测 promptTokens / 模型窗口` 百分比（>70% 黄、>90% 红）

## 先出思路（Plan-first，默认开启）

新问题默认先进入规划阶段：AI 只做表结构探查与小样本验证，输出 **PlanReviewCard** 思路确认卡（方法、步骤、数据源、澄清问题）；你确认（或直接回复补充意见）后才产出完整看板。输入框左下角的「先出思路」开关可逐会话关闭，**选择持久化在服务端会话中**——切换会话、换浏览器均保留各自偏好；预设场景为保持一键直达仍直出看板。

## 常用命令

```bash
pnpm dev          # 开发（端口 3006）
pnpm test         # Vitest 单元测试
pnpm run lint     # ESLint
pnpm run typecheck# tsc --noEmit
pnpm run build    # 生产构建
```

## 安全说明

- `execute_sql` 仅允许 `SELECT` / `WITH` 只读查询，禁止多语句与 DDL/DML 关键字，默认追加 `LIMIT 200`；执行层强制只读事务 + 5s `statement_timeout` 作为硬约束。
- 任一 MCP 数据源加载失败时自动降级为空工具集，不会拖垮整个分析请求。
- 凭证边界：客户端在「LLM 设置」中自定义 baseURL 时必须同时提供自己的 apiKey，服务端不会用环境变量中的 Key 去请求客户端指定的 URL（防凭证外泄）。GitLab token 通过自定义请求头传递，不进入 URL。

### 部署注意事项

本项目默认面向本地单机使用。部署到共享环境前请务必：

1. 配置 `OPENUI_API_AUTH_TOKEN` 启用 API 鉴权（见环境变量章节）；
2. 为 PostgreSQL 连接使用**只读角色**（应用层守卫之外的第二道防线）；
3. 限制可访问的 GitLab MCP endpoint 范围（SSRF 面）；
4. `data/` 目录含敏感数据副本：`data/schema-cards/`（表结构/取值分布画像）与 `data/files/`、`data/dashboards/`（数据快照与 DSL）——部署环境请收紧目录权限，并知悉这些文件**不经过任何鉴权**即可被本机进程读取。
