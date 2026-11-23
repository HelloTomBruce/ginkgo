# Ginkgo

**Ginkgo 智能体应用平台**：统一对话宿主 + 可插拔应用体系 + 平台级 Agent 运行底座。

用自然语言提问，由 LLM 编排 **PostgreSQL / MySQL / SQLite / ClickHouse / GitLab / 禅道 / 文件（CSV·Excel → DuckDB）** 多路数据源取数，流式生成**看板 DSL** 声明式可视化界面（KPI 卡、漏斗、热力图、雷达图、预算模拟器等）并实时渲染。**数据分析（analytics）** 与 **通用助手（general）** 是平台的前两个应用——新应用接入零宿主改动，见 [docs/app-integration-guide.md](docs/app-integration-guide.md)。

## 底座架构

分层与依赖方向恒为单向：**壳 → 应用 → 能力 → 协议**（逆向与跨层禁止）。

```text
┌────────────────────────────────────────────────────────────────┐
│ L4 宿主壳 src/（Next.js 16 / React 19）                        │
│  装配组合根（registry / runtimeServers / API 薄壳路由）         │
│  通用 UI 框架：ChatDashboard · ChatSidebar · MessageList 时间线 │
│  零应用领域语义——一切按应用声明渲染                              │
└──────────────┬─────────────────────────────────────────────────┘
               │ POST /api/analyze（Data Stream Protocol，按 appId 装配）
               ▼
┌────────────────────────────────────────────────────────────────┐
│ L3 应用包 packages/apps/*（协议：openui-app-sdk）               │
│  app-analytics：三模式 prompt / 数据源与跨源工具 / 方法卡 /      │
│                 看板产物域（收藏·物化·重放·模板，全自持）        │
│  app-general：沙箱原子工具（消费 openui-sandbox）/ ArtifactViewer│
├────────────────────────────────────────────────────────────────┤
│ L2 能力包 packages/openui-*                                     │
│  sandbox（沙箱原子工具+权限档）· datasources（直连+只读网关）    │
│  components（看板组件库+渲染基建+UI 原语）· chart-spec（spec 契约）│
│  methodology（方法卡资产）· harness-core（通用 Agent 底座）      │
├────────────────────────────────────────────────────────────────┤
│ L1 编排层 openui-llm（领域中立）                                 │
│  streamText + 模型链韧性 + StreamHub 流中继 + 三维熔断 +         │
│  上下文投影治理 + 四接缝（prompt/tools/deliverable/onTaskFinish）│
├────────────────────────────────────────────────────────────────┤
│ L0 协议层 openui-app-sdk：契约唯一事实来源（类型 + defineApp）   │
└────────────────────────────────────────────────────────────────┘
               │ 模型输出 ```openui 代码块
               ▼
        OpenUIRenderer 流式渐进渲染为可交互看板
```

**五条底座原则**（裁决一切新代码，详见 [AGENTS.md](AGENTS.md)）：

1. **契约先行**——一切扩展点在 app-sdk 声明：client 声明 UI 能力，server 声明运行时能力；
2. **组合根唯一**——appId→实现的绑定只在 registry / runtimeServers / API 薄壳路由；
3. **语义声明化**——宿主区分应用的判断必须是应用声明的数据（布尔/枚举/子串 pattern），禁止 appId 比较、话术正则、硬编码文案；
4. **API 薄壳化**——Next.js 文件路由只做「拆包 → 委托包内 handler → 状态码映射」，业务校验与编排归包；
5. **依赖单向**——应用间、能力间互不 import（经协议层类型）。

## 包结构

| 包 | 门面 | 职责 |
| --- | --- | --- |
| `packages/openui-app-sdk` | `defineApp` / `AppPackageDefinition` | **L0 协议层**：manifest、客户端插槽、服务端契约、产物协议、消息区扩展 |
| `packages/apps/app-analytics` | `createAnalyticsServer` | 智能数据分析师应用（深度应用）：三模式 prompt、schema 摘要、方法卡、跨源映射、数据源工具、**看板产物域全自持**（isomorphic 变换/捕获/快照 + server 收藏存储/SQL 物化/活看板重放/模板重绑定） |
| `packages/apps/app-general` | `getGeneralTools`（server 入口） | 通用智能助手应用：沙箱原子工具（消费 openui-sandbox）、ArtifactViewer 产物工作台 |
| `packages/openui-sandbox` | `createSandboxTools` | 沙箱工作区能力包：四原子工具（read/edit/write/bash）+ explorer 只读增强预设、full/readonly 权限档、run_command env 白名单、prompt 片段 |
| `packages/openui-chart-spec` | `parseDashboardSpec` / `applyJsonPatch` | DashboardSpec 2.0 声明式状态树 + RFC 6902 JSON Patch 引擎（zod-only） |
| `packages/openui-harness-core` | `ContextEngine` / `createTerminationTool` / `MCPClientManager` | 通用 Agent Harness：上下文裁剪压缩、洋葱模型工具切面、任务生命周期断言、三维预算防跑飞、MCP 连接池、FinOps 台账 |
| `packages/openui-datasources` | `createDatasourceManager` / `QueryGateway` | 结构化数据源直连 + QueryGateway 安全网关 + 只读守卫管线 + Schema Card + Certified Queries 语义层 |
| `packages/openui-components` | `analyticsLibrary` | 看板规范展示组件库（24 组件）+ 渲染基建（serverLibrary schema 面 / OpenUIRenderer / DSL 校验器 / FilterBus）+ 共享 UI 原语（button/dialog） |
| `packages/openui-llm` | `createAnalyzeHandler` | **领域中立** LLM 编排：模型链韧性、StreamHub 流中继、三维熔断、上下文投影治理、四接缝 |

宿主 `src/` 只保留：组合根装配、通用 UI 框架（会话流/消息时间线/设置中心）、API 薄壳路由（`analyze` / `dashboards` / `methodology` / `sessions` / `workspace` 等均为拆包转发）。

## 底座契约：插槽与能力

应用**声明**客户端插槽（宿主按声明渲染）、**实现**服务端接缝（宿主调用）、**消费**能力包工厂。完整契约见 [docs/app-integration-guide.md](docs/app-integration-guide.md)，摘要：

**客户端插槽**（`AppClientContract`）：`welcomeMessage`、`presetQueries` + `resolvePresetQueries`（运行时推荐解析）、`WorkspaceComponent` / `InputAccessoryComponent`、`sidebarTabs` / `sidebarQuickActions`（含 `Component` 弹层插槽）、`dashboardToolbar`（看板操作能力）、`messageExtensions`（消息区扩展：规划确认/终态总结/过渡文案）、`workspaceView` / `workspaceMount`。

**服务端接缝**（`AppServerContract`）：`buildSystemPrompt` / `getTools` / `needsWorkspace`（会话沙箱注入）/ `requiresDataTools` / `listArtifacts` / `refreshArtifact`；`ctx.mode`（direct/plan/execute）贯穿 prompt 与工具装配——如 plan 模式沙箱自动收敛为只读档。

**能力消费**：沙箱工具（`@openui-analytics/sandbox`）、数据源网关（datasources）、看板渲染（components + chart-spec）、方法卡（methodology）、`zodTool` 等底座设施（harness-core）。能力包不 import 应用与宿主，经协议层类型解耦。

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
| `LLM_TASK_TIMEOUT_MS` | 单任务 wall-clock 上限（超时自动中止） | 600000（钳 30s–60min） |
| `LLM_TASK_TOKEN_BUDGET` | 单任务累计 token 预算（超限写 `budget_exhausted` 终态并中止） | 600000（钳 10k–5M） |
| `LLM_MAX_CONCURRENT_TASKS` | 进程级同时 running 任务数上限（超限返回 429） | 8（钳 1–64） |
| `LLM_TOOL_OUTPUT_MAX_BYTES` | 单个工具结果进入模型上下文的字节上限（头尾保留截断） | 32768（钳 4KB–1MB） |
| `LLM_MAX_OUTPUT_TOKENS` | 每步输出 token 上限 | 16384（钳 1024–65536） |
| `LLM_PLAN_MAX_STEPS` | plan 模式独立步数预算 | 继承 maxSteps |
| `PGUSER` / `PGHOST` / `PGDATABASE` / `PGPASSWORD` / `PGPORT` | 分析库连接（缺表自动建表写示例数据） | 本机 `openui_analytics` 库 |
| 动态 DB 源（设置中配置） | `dbType` 四选：postgres / mysql / **sqlite** / **clickhouse**。全部只读双保险（词法守卫 + 引擎级只读） | — |
| GitLab MCP Endpoint / Token | 在页面「设置」中配置，存于浏览器 localStorage | `http://127.0.0.1:5002/mcp` |
| `OPENUI_API_AUTH_TOKEN` | 部署模式 API 鉴权令牌；配置后所有 `/api/*` 须携带 `Authorization: Bearer <token>` | 无 |

禅道数据源依赖本机已登录的 `zentao` CLI（`zentao mcp --read-only`），无需额外配置。

### 自定义分析方法卡

内置 10 张通用方法卡（趋势/帕累托/漏斗/RFM/同期群/异常检测/归因/目标差距/排名/分布，资产在 `packages/apps/app-analytics/src/methodology`）。自定义卡放入 `data/methodology/*.json`（单卡对象或卡数组，字段见 `MethodCard` 契约）即可扩展或覆盖（同 id 覆盖内置），重启生效；坏文件跳过并告警，不影响启动。

## 活看板（数据刷新）

收藏看板不只是静态快照：生成期捕获的取数查询（`queries`/`bindings`）随收藏落盘，可在**预览弹窗一键刷新数据**——服务端按序重放查询并回填组件数值，**全程零 LLM 调用**。

- **派生变换（transform）**：直取匹配失败的组件，捕获引擎把「LLM 加工」推测为**确定性变换 spec**（封闭算子）并做**一致性验证**——验证通过才绑定落盘，刷新时重放后按 spec 重算回填；验证不过维持纯快照降级（宁缺勿错）
- **SpecChart 零 LLM 物化**：图表携带声明式 `ChartSpec`（dims/meas/filters），二次交互或刷新时服务端直接按 spec 物化取数回填，换图不换绑定
- **动态时间宏**：滚动宏（如 `TODAY - 30d`）使周期性看板随时间自动前滑，避免日期死编码
- **可刷新率约束**：prompt 强制聚合下推 SQL、组件行原样复用查询结果——大多数看板直接命中直取绑定
- **安全边界**：`kind:"tool"` 查询经**只读白名单**复核后才重放，写语义工具一律拒绝；单查询失败该组件保留旧数据并标「数据过期」，全部失败则整体不落盘
- **实现**：`@openui-apps/analytics/server`（`refreshDashboard` + 物化/重放引擎）+ 宿主薄壳 `POST /api/dashboards/[id]/refresh`

## 筛选联动与事件总线（FilterBus）

- **作用域事件总线**：组件间轻量发布-订阅，看板级 `scopeId` 隔离；维护当前筛选字典（`getFilterState` / `replayCurrent`），组件二次挂载无缝恢复
- **`AnalyticsFilterBar`**：声明模式（自动从 distinct 端点拉候选项）与参数演示模式
- **`DataTable`**：前端轻量分页、列排序、关键词搜索与 CSV 导出，严格空值排他匹配守卫

## 渲染性能与流式平滑

- **流式 AST 解析节流**：`useStreamingThrottled` 将流式看板 AST 重解析降频至 ~8fps，流式结束立即全量对齐
- **增量合批**：`experimental_throttle=100`（leading+trailing）对流式渲染合批
- **思考流尾部窗口**：流式期间只渲染尾部 3000 字符（每帧重排成本恒定），完成后回源全文
- **图表尺寸震荡防御**：Recharts 在 Grid 排版下的 ResizeObserver 震荡，容器全量 `minWidth={0} debounce={50}`
- **坏调用自愈三层防线**：参数校验失败/幻觉工具名 → 编排层 repair 反馈（附目标工具 schema）自我纠正；execute 异常 → 结构化 `{error, isError}` 反馈不终结流；流内 error chunk → 真实错误透出 + 遥测 + 友好降级

## 流式会话生命周期与断线重连（StreamHub）

服务端与客户端生命周期解耦：**切换/新建/刷新页面不杀任务，显式「停止」才真正终止**。

- **后台续跑**：客户端脱钩仅中止订阅并落盘进度，任务由服务端独立 Reader 继续生成并全量缓冲
- **无缝续接**：回切时探针 `GET /api/analyze?sessionId=` 返回 `running/hasTask`，命中即在终态保留窗内重放并实时续接
- **即刻中止**：显式停止经 `abortTask` 取消 provider 侧生成；任务级看门狗防挂起
- **防双消费**：「提交在途」守卫拦截重连探测窗口期的双端接入

## 运行时防护与可观测

| 防线 | 触发行为 |
| --- | --- |
| 任务看门狗 | wall-clock 超限自动中止 |
| token 预算熔断 | 超限写 `budget_exhausted` 终态并中止 provider |
| 并发准入 | running 达上限返回 429；重连不占名额 |
| 工具结果截断 | 超长结果以 `<tool_output untrusted>` 信封头尾保留 |
| 重复循环熔断 | 推理退化（同形重复 ≥15 次）自动截断并注入说明 |

- **结构化遥测**：`HarnessEvent` 事件流（run_start / step_finish / tool_result / task_finish / abort / reconnect…）NDJSON 输出，可注入 `TelemetrySink` 接 OTel
- **finish_task 服务端不变量**：无实质产出时 `completed` 被拒绝（提示改用 `insufficient_data`），防模型空口宣告完成

## 评测体系（Evals）

- **Tier A 轨迹回归（进 CI）**：`packages/openui-llm/src/evals/trajectories.test.ts` 脚本化模型剧本驱动全链路，锁定工具调用序列、终态类型、token 锚点、上下文投影与不变量门
- **Tier B 真实模型评估（手动/夜间）**：`packages/openui-llm/src/evals/tier-b.real-model.test.ts` 真实模型跑固定问题集，轨迹指标落盘基线对比；无 Key 自动跳过。**prompt/模型变更前后各跑一次**

## 会话存储与操作

会话（消息历史、数据源选择、标题）持久化在服务端 `data/sessions/`（单会话单 JSON，原子写入）——换浏览器、清缓存会话不丢。接口：`GET/POST/PUT /api/sessions` 与 `GET/PUT/DELETE /api/sessions/:id`；旧版 localStorage 会话首次加载一次性自动迁移。

- **分叉**：任意消息「分叉」把到此为止的对话复制为新会话（继承数据源选择），适合从中间结论探索不同方向
- **回滚重问**：用户消息「回滚重问」截断其后全部对话，内容回填输入框修订重发；token 锚点与摘要缓存随之重置

## 上下文治理（投影式压缩）

**存储层永远保存完整会话，压缩只作用于「发往模型的投影」**：

- **token 计量**：最后一步实测 `usage.promptTokens` 回写作锚点，后续消息字符启发式估算，误差逐轮自校正
- **第一道 tool-result pruning**：保留窗口外的工具结果替换为占位符；用户消息与规划卡豁免
- **第二道 LLM 摘要**：pruning 后仍超阈值，旧历史压缩为摘要注入 system prompt（增量复用）
- **用量条**：输入框上方实时显示 `实测 promptTokens / 模型窗口`（>70% 黄、>90% 红）

## 先出思路（Plan-first，默认开启）

新问题默认先进规划：AI 只做表结构探查与小样本验证，输出 **PlanReviewCard** 思路确认卡；确认后才产出完整看板。开关逐会话持久化在服务端。**plan 模式的限制是工具层强制的**：沙箱权限档收敛为 readonly（只装配只读工具），方案经确认进入 execute 后写入与命令执行自动解锁。

## 常用命令

```bash
pnpm dev          # 开发（端口 3006）
pnpm test         # Vitest 全仓测试
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm build        # 生产构建
```

## 安全说明

- `execute_sql` 仅允许 `SELECT` / `WITH` 只读查询，禁止多语句与 DDL/DML，默认追加 `LIMIT 200`；执行层强制只读事务 + 5s `statement_timeout` 硬约束
- 沙箱 `run_command` 环境变量默认白名单（敏感变量如 API Key 不进入模型可诱导的 shell 环境），高危命令黑名单拦截 + 超时防护
- 任一 MCP 数据源加载失败自动降级为空工具集，不拖垮分析请求
- 凭证边界：客户端自定义 baseURL 时必须同时提供自己的 apiKey，服务端不会用环境变量 Key 请求客户端指定 URL；GitLab token 走自定义请求头不进 URL

### 部署注意事项

本项目默认面向本地单机使用。部署到共享环境前请务必：

1. 配置 `OPENUI_API_AUTH_TOKEN` 启用 API 鉴权；
2. 为 PostgreSQL 连接使用**只读角色**（应用层守卫之外的第二道防线）；
3. 限制可访问的 GitLab MCP endpoint 范围（SSRF 面）；
4. `data/` 目录含敏感数据副本（`data/schema-cards/`、`data/files/`、`data/dashboards/`）——请收紧目录权限，并知悉这些文件**不经过任何鉴权**即可被本机进程读取。
