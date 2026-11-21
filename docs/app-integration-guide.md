# OpenUI 平台应用接入规范

> 适用版本：平台化收敛（llm 领域中立化 + 产物协议）之后。
> 本文是新增/接入一个 OpenUI 平台应用的**唯一规范入口**，以 analytics（深度应用）与
> general（轻应用）为双实例讲解。协议类型唯一事实来源：`packages/openui-app-sdk/src/types.ts`。

## 1. 平台架构总览

```text
┌─────────────────────────────────────────────────────────────────┐
│ 宿主壳层 src/（应用无关）                                          │
│ ChatDashboard · AppSwitcher · ChatSidebar · MessageList ·        │
│ /api/analyze（统一入口）· middleware · sessionStore/dashboardStore │
├─────────────────────────────────────────────────────────────────┤
│ 应用插件层 packages/apps/*（协议：@openui-analytics/app-sdk）       │
│   app-analytics：数据智能（深度应用，工厂装配）                      │
│   app-general：通用助理（轻应用，静态包即全量）                      │
├─────────────────────────────────────────────────────────────────┤
│ 平台服务层                                                        │
│ ① Agent 编排：openui-llm（领域中立）+ harness-core（执行底座）      │
│    统一入口按 appId 分发：resolveAppPrompt / resolveAppTools /     │
│    deliverable / onTaskFinish 四接缝                              │
│ ② 数据语义层：openui-datasources（requiresDataTools 应用可复用）    │
│ ③ 声明式渲染：openui-components（analyticsLibrary + serverLibrary  │
│    + OpenUIRenderer + DSL 校验器）                                │
│ ④ 方法论资产：openui-methodology                                   │
│ ⑤ 工作区沙箱：workspaceStore / workspaceResolver                  │
│ ⑥ 产物协议：AppArtifactItem / listArtifacts / refreshArtifact     │
└─────────────────────────────────────────────────────────────────┘
```

**关键不变量**：
- `@openui-analytics/llm` 零应用领域语义（无内置业务 prompt、无数据源装配、无交付物文案）；
  一切领域逻辑经四接缝注入。
- 依赖方向单向：`apps → app-sdk + 平台服务包`；app 包**禁止**穿透宿主 `src/`（tsconfig
  不得配置 `@/*` 指向宿主；需要的共享 UI 原语在应用包内自持或由 components 包提供）。
- 宿主组合根（`src/lib/analyticsRuntime.ts` + `src/lib/apps/runtimeServers.ts` +
  `src/app/api/analyze/route.ts`）是**唯一**允许出现 appId 装配特判的地方。

## 2. 应用包结构标准

```text
packages/apps/app-<id>/
├── package.json          # exports: "." / "./client" / "./server" 三出口
├── tsconfig.json         # 无 paths 穿透宿主
├── vitest.config.ts      # node 环境，include src/**/*.test.ts
└── src/
    ├── index.ts          # defineApp(...) 静态包定义 + 默认导出
    ├── manifest.ts       # manifest + client contract（含插槽组件声明）
    ├── client/           # 客户端插槽组件（Workspace / InputAccessory / 侧栏面板）
    │   ├── index.ts
    │   └── ui/           # 自持 UI 原语（hint/checkbox/tooltip 等，勿穿透宿主）
    ├── server/           # 服务端：prompt 构造 / 工具装配 / 产物服务
    │   └── index.ts      # createXxxServer(deps) 工厂（需运行时依赖时）
    └── evals/            # 真实模型评测（可选，缺 Key 自动跳过）
```

**静态包 vs 运行时工厂**：
- **轻应用**（无运行时依赖）：直接在 `server` 契约上提供 `buildSystemPrompt` / `getTools`
  （见 app-general）。静态包即全量。
- **深度应用**（需要宿主单例：数据源管理器、方法论库、产物存储…）：静态包 `server` 只带
  元数据（`requiresDataTools` / `requiredCapabilities`），运行时逻辑经
  `createXxxServer(deps)` 工厂装配，宿主组合根注入依赖后使用工厂实例
  （见 app-analytics 的 `createAnalyticsServer`）。

## 3. 清单与客户端插槽（AppClientContract）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `welcomeMessage` | ✓ | 新会话默认欢迎语 |
| `presetQueries` | ✓ | 推荐问题列表（侧栏「推荐」面板） |
| `defaultInteractionMode` | | `"plan"`（先出思路，默认）/ `"build"`（直出） |
| `WorkspaceComponent` | | 右侧工作台插槽组件（不提供则纯对话布局） |
| `InputAccessoryComponent` | | 输入栏挂件插槽（如 analytics 的数据源选择器） |
| `sidebarTabs` | | 侧栏扩展 Tab；不提供 `Component` 时按 key 借用宿主内置面板（`dashboards` 收藏库 / `presets` 推荐），提供则应用完全自治渲染 |
| `sidebarQuickActions` | | 侧栏底部快捷操作（通用渲染：`label`/`icon` 生效；`onClick` 缺省解析宿主内置能力 `methodology` / `component-catalog`） |
| `hasWorkspace` / `hasInputAccessory` | | 标志位（快速判定，避免取组件判空） |

插槽组件 Props 契约见 `AppWorkspaceProps` / `AppInputAccessoryProps` / `AppSidebarTabProps`。
渲染基建（`OpenUIRenderer`、`DashboardScopeProvider`、`filterBus`、组件 Def）统一从
`@openui-analytics/components` 取——客户端本地工具经宿主挂载的
`<OpenUIToolProvider>` 自动生效，无需逐层透传。

## 4. 服务端契约（AppServerContract）

```ts
interface AppServerContract {
  buildSystemPrompt?(ctx: AppServerContext): Promise<string> | string;
  getTools?(ctx: AppServerContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  requiresDataTools?: boolean;
  requiredCapabilities?: string[];
  listArtifacts?(ctx: AppWorkspaceContext): Promise<AppArtifactItem[]>;
  refreshArtifact?(input: { artifactId: string }): Promise<AppArtifactRefreshVerdict>;
}
```

### 4.1 AppServerContext 字段全景

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `appId` / `sessionId` | 平台 | 标识与编排状态定位 |
| `mode` | 请求体 | `direct` / `plan` / `execute` 三态（语义由应用定义） |
| `messages` | 请求体 | 前序消息（含 plan 卡） |
| `userQuery` | 平台提取 | 最新用户提问（语义召回 / 认证口径匹配） |
| `enabledSources` | 请求体 | 会话启用的数据源 id（requiresDataTools 应用装配工具用） |
| `activeSources` | 平台 | MCP 源摘要（含已装载工具名），供 prompt 数据访问段渲染 |
| `sessions` | 平台通道 | 会话上下文读写（`pendingPlan` 等编排状态，增量合并语义） |
| `workspace` | 宿主解析 | 沙箱目录（`sandboxDir`）与外部绑定路径边界 |
| `schemaDigestText` / `methodologyText` | （预留） | 文本摘要通道，深度应用通常自行计算 |

### 4.2 四接缝（平台编排层 → 应用）

| 接缝 | 时机 | 应用职责 |
| --- | --- | --- |
| `resolveAppPrompt(appId, ctx)` | 每请求一次，投影前 | 返回应用 System Prompt（undefined → 平台中立兜底；平台强制追加注入防御纪律段，已含则不重复） |
| `resolveAppTools(appId, ctx)` | prompt 前 | 返回应用工具集（经遥测切面包装后挂载；数据源工具在此由应用装配） |
| `deliverable`（AppDeliverableContract） | 工厂期 | finish_task 终态语义：工具描述 / 拒绝文案 / 收尾指令 / 证据标记（如 `["```openui", "PlanReviewCard"]`） |
| `onTaskFinish(event)` | onFinish 后（fire-and-forget） | 登记编排状态（analytics：plan 轮提取方法卡写 `pendingPlan`） |

**平台兜底**：未注入 prompt → 中立基础提示词 + 注入防御段；无证据标记命中且零文本 →
finish_task `completed` 被拒（空跑防护不变量）。

### 4.3 数据能力复用（requiresDataTools 类应用）

数据源管理器（`createDatasourceManager`）、查询网关（四层只读守卫）、Schema Card、
Certified Queries 是平台数据语义层，任何数据类应用可复用：

```ts
// 应用工厂内（依赖注入，包不自建单例）
export function createXxxServer(deps: { datasources: DatasourceManager; ... }) {
  return {
    async getTools(ctx) {
      const active = deps.datasources.resolveActive(ctx.enabledSources);
      // 逐源 tools(conf) → toAiTools(bindings, { sourceId })（失败源降级跳过）
    },
    async buildSystemPrompt(ctx) { /* schemaDigest + 认证口径 + 领域规则段 */ },
  };
}
```

宿主组合根注入：`src/lib/analyticsRuntime.ts` 是范例（datasources / methodology /
artifacts 三类依赖的装配点）。

## 5. 工作区与沙箱边界

- 会话可绑定工作区（`data/workspaces/_workspaces.json`，`session.workspaceId` →
  `WorkspaceRecord.path`）；未绑定用默认沙箱 `data/workspaces/{appId}/{sessionId}`。
- 应用文件/命令工具必须经 `resolveSafeWorkspacePath` 收敛在沙箱内（防路径穿越），
  高危命令黑名单 + 超时 + 输出上限参照 `app-general/src/server/tools.ts`。

## 6. 产物协议（平台产物体系）

| 能力 | 协议 | analytics 实现 |
| --- | --- | --- |
| 归属 | `DashboardRecord.appId`（存量读时归一 `analytics`）；列表按 `?appId=` 过滤 | 收藏/列表/刷新全链路携带 appId |
| 枚举 | `listArtifacts(ctx) → AppArtifactItem[]` | 看板收藏 → `{type: "dashboard"}` 投影 |
| 刷新 | `refreshArtifact({artifactId}) → AppArtifactRefreshVerdict`（compute-only，平台路由负责持久化） | 活看板查询重放 + transforms 重算 + SpecChart 物化（零 LLM） |

失败原因归一：`readonly`（静态快照）/ `not-found` / `unsupported`（应用未启用刷新）/
`source-unavailable` / `replay-failed` / `dsl-invalid`。HTTP 映射见
`src/app/api/dashboards/[id]/refresh/route.ts`。

## 7. 注册与组合根接线

1. **静态注册**：`src/lib/apps/registry.ts` 构造器 `register(xxxAppPackage)`（import 静态包）。
2. **运行时装配**（仅深度应用需要）：在 `src/lib/<app>Runtime.ts` 建工厂实例，
   并在 `src/lib/apps/runtimeServers.ts` 的 `resolveRuntimeServer` 加一行 appId 特判。
3. **接缝接线**：`src/app/api/analyze/route.ts` 的 `createAnalyzeHandler` 注入四接缝
   （已通用化：`resolveRuntimeServer` 分发 prompt/tools，`deliverable`/`onTaskFinish`
   指向应用运行时实例）。
4. **产物接线**（可选）：应用实现 `refreshArtifact` 后，产物刷新路由自动按
   `record.appId` 分发。

## 8. 测试与评测约定

- **单元/集成**：应用包自带 `vitest.config.ts`（node 环境）；prompt 快照与装配行为
  在应用包内锁定（参照 `app-analytics/src/server/analyticsServer.test.ts`：
  工具装配降级 / 跨源注册 / 三模式 prompt / pendingPlan 交接 / 认证口径注入）。
- **平台机制回归**：`packages/openui-llm/src/handler.test.ts` + `evals/trajectories.test.ts`
  用 `resolveAppTools`/`resolveAppPrompt` stub 驱动（机制与领域解耦验证）。
- **真实模型评测（Tier B）**：`src/evals/tier-b.real-model.test.ts`（应用包内，缺 Key
  自动跳过）：`pnpm eval:tier-b`。prompt/模型变更前后各跑一次，对比基线合规率与成本。
- few-shot 示例与组件 schema 的一致性由 `promptExamples.test.ts` 守护（createParser
  全量解析）。

## 9. 接入检查清单

- [ ] `defineApp()` 定义静态包；manifest.id 匹配 `^[a-z0-9_-]{1,64}$`
- [ ] 三出口 exports（`.` / `./client` / `./server`）；tsconfig 无宿主 paths 穿透
- [ ] welcomeMessage / presetQueries 已配置；默认交互模式已声明
- [ ] 需要数据工具 → `requiresDataTools: true` + 工厂内 resolveActive 装配（失败源降级）
- [ ] System Prompt 由 `buildSystemPrompt` 自治产出（勿依赖平台内置业务段；注入防御段
      平台会强制追加，勿重复内联）
- [ ] 交付物语义 → `AppDeliverableContract`（含证据标记）；plan→execute 状态经
      `sessions.pendingPlan` 交接（消费即清空）
- [ ] 产物（若有）→ `appId` 归属 + `listArtifacts` + （可刷新则）`refreshArtifact`
- [ ] registry 注册 + （深度应用）runtimeServers 装配
- [ ] `pnpm lint && pnpm typecheck && pnpm test` 全绿；prompt 变更跑一次 `pnpm eval:tier-b`
