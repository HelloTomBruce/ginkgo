# Ginkgo 平台应用接入规范

> 适用版本：平台化收敛（llm 领域中立化 + 产物协议）之后。
> 本文是新增/接入一个 Ginkgo 平台应用的**唯一规范入口**，以 analytics（深度应用）与
> general（轻应用）为双实例讲解。协议类型唯一事实来源：`packages/ginkgo-app-sdk/src/types.ts`。
> 平台侧能力包扩展与第三方应用分发的演进路线见
> [平台生态路线图](platform-ecosystem-roadmap.md)。

## 1. 平台架构总览

```text
┌─────────────────────────────────────────────────────────────────┐
│ 宿主壳层 src/（应用无关）                                          │
│ ChatDashboard · AppSwitcher · ChatSidebar · MessageList ·        │
│ /api/analyze（统一入口）· middleware · sessionStore/dashboardStore │
├─────────────────────────────────────────────────────────────────┤
│ 应用插件层 packages/apps/*（协议：@ginkgolab/app-sdk）       │
│   app-analytics：数据智能（深度应用，工厂装配）                      │
│   app-general：通用助理（轻应用，静态包即全量）                      │
├─────────────────────────────────────────────────────────────────┤
│ 平台服务层                                                        │
│ ① Agent 编排：ginkgo-llm（领域中立）+ harness-core（执行底座）      │
│    统一入口按 appId 分发：resolveAppPrompt / resolveAppTools /     │
│    deliverable / onTaskFinish 四接缝                              │
│ ② 数据语义层：ginkgo-datasources（requiresDataTools 应用可复用）    │
│ ③ 声明式渲染：ginkgo-components（analyticsLibrary + serverLibrary  │
│    + UiSpecRenderer + DSL 校验器）                                │
│ ④ 沙箱原子工具：ginkgo-sandbox（preset × permission 双维度）        │
│ ⑤ 工作区沙箱解析：workspaceStore / workspaceResolver              │
│ ⑥ 产物协议：AppArtifactItem / listArtifacts / refreshArtifact     │
└─────────────────────────────────────────────────────────────────┘
```

**关键不变量**：
- `@ginkgolab/llm` 零应用领域语义（无内置业务 prompt、无数据源装配、无交付物文案）；
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
| `welcomeMessage` | ✓ | 新会话欢迎语（应用自治；宿主兜底文案领域中立） |
| `presetQueries` | ✓ | 静态推荐问题列表（声明 `resolvePresetQueries` 时作解析失败兜底） |
| `resolvePresetQueries` | | 推荐列表运行时解析插槽（`async () => AppPresetQuery[]`，如方法卡合并集）；宿主在 effect 中按应用条件调用 |
| `defaultInteractionMode` | | `"plan"`（先出思路，默认）/ `"build"`（直出） |
| `WorkspaceComponent` | | 右侧工作台插槽组件（不提供则纯对话布局） |
| `workspaceView` | | 工作区视图语义：`"canvas"`（分析画布，canvas-only 需先钉选看板）/ `"files"`（文件产物，缺省） |
| `workspaceMount` | | 会话支持挂载本地文件夹（侧栏「选择文件夹」按钮渲染开关） |
| `InputAccessoryComponent` | | 输入栏挂件插槽（如 analytics 的数据源选择器） |
| `sidebarTabs` | | 侧栏扩展 Tab；不提供 `Component` 时按 key 借用宿主内置面板（`dashboards` 收藏库 / `presets` 推荐），提供则应用完全自治渲染 |
| `sidebarQuickActions` | | 侧栏底部快捷操作：`onClick` 应用自治；**`Component` 弹层插槽**（`{ open, onClose }`，宿主统一管理 open 状态——方法论查看器等）；内置能力 key `component-catalog` 保持宿主解析 |
| `settingsSections` | | 设置中心应用分区：宿主在平台 tab（模型/数据源/…）之后按声明追加，仅渲染当前应用的分区；Props 为 `AppSettingsSectionProps`（`appId` + 宿主签发的带鉴权 `request`），内容与持久化应用自治（即时保存语义，不经宿主底部「保存配置」）。平台级、跨应用共享的配置（模型/数据源/MCP）归宿主与能力包，不在此声明 |
| `dashboardToolbar` | | 消息内看板区块工具条能力声明（`title`/`pin`/`favorite`/`exportPdf`）；未声明的应用不渲染操作按钮 |
| `messageExtensions` | | 消息区扩展声明：`planConfirm`（patterns 子串匹配 → 确认按钮）/ `completion`（finish_task 后无看板代码的总结卡）/ `toolSettledHint`（工具完成过渡文案）；未声明的应用全部中性渲染 |
| `hasWorkspace` / `hasInputAccessory` | | 标志位（快速判定，避免取组件判空） |

**语义声明化红线**：宿主区分应用的判断只能消费上表的声明数据（布尔/枚举/子串
pattern），禁止在宿主组件里写 appId 比较、话术正则或硬编码文案。新交互扩展一律
先加契约字段、再让宿主按声明渲染。

插槽组件 Props 契约见 `AppWorkspaceProps` / `AppInputAccessoryProps` / `AppSidebarTabProps`；
画布钉选载荷类型为协议层 `AppCanvasData`。渲染基建（`UiSpecRenderer`、
`DashboardScopeProvider`、`filterBus`、组件 Def）统一从 `@ginkgolab/components`
取——客户端本地工具经宿主挂载的 `<UiSpecToolProvider>` 自动生效，无需逐层透传。

## 4. 服务端契约（AppServerContract）

```ts
interface AppServerContract {
  buildSystemPrompt?(ctx: AppServerContext): Promise<string> | string;
  getTools?(ctx: AppServerContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  requiresDataTools?: boolean;
  /** 声明需要会话沙箱（宿主解析 workspace 并注入 AppServerContext.workspace） */
  needsWorkspace?: boolean;
  /** 声明依赖的平台底层能力（组合根按 KNOWN_APP_CAPABILITIES 词汇表校验） */
  requiredCapabilities?: string[];
  listArtifacts?(ctx: AppWorkspaceContext): Promise<AppArtifactItem[]>;
  refreshArtifact?(input: { artifactId: string }): Promise<AppArtifactRefreshVerdict>;
  /** 应用自治动作分发网关（宿主 POST /api/apps/[appId]/action 校验后转发） */
  dispatchAction?(action: string, payload: Record<string, unknown>, ctx: AppActionContext): Promise<unknown>;
  /** 会话终止钩子（宿主删除会话时触发，释放浏览器等会话级资源） */
  onSessionEnd?(sessionId: string): Promise<void>;
}
```

沙箱文件/shell 工具不要自研：消费 `@ginkgolab/sandbox` 能力包的
`createSandboxTools({ sandboxDir, preset: "atomic" | "explorer", permission: "full" | "readonly" })`
——preset 是丰富度维度（atomic = read/edit/write/bash 四原子工具；explorer 追加
list_dir），permission 是权限维度（readonly 只装配只读工具）；工具说明 prompt 片段
用 `sandboxToolsPromptSection(preset, permission)` 与装配同源拼接。

浏览器自动化工具同理消费 `@ginkgolab/browser` 能力包（基于 dsh-browser-view 的
Playwright 驱动 + 意图语义定位）：

```ts
import { createBrowserTools } from "@ginkgolab/browser";

const browserPkg = createBrowserTools({
  sessionId: ctx.sessionId,          // 会话命名空间（dsh session scope 隔离多会话实例）
  workspaceDir: sandboxDir,          // 截图/下载/基线落盘根目录（派生 screenshots/ 等子目录）
  permissionLevel: ctx.mode === "plan" ? "readonly" : "full",
  toolset: "core",                   // 25 个高频工具（省 prompt 常驻 token）；"all" 为全量 39 个
  headless: true,
});
// browserPkg.tools 直接展开进 getTools 返回值；promptSection 与 tools 由同一
// permissionLevel 派生（同源判定，prompt 宣称与实际能力永不漂移）。
```

只读档（plan 模式）在**装配层**按 `READONLY_BROWSER_TOOLS` allowlist 直接裁剪——
写副作用工具（click/type/press/eval/表单等）根本不注册，而非仅靠 prompt 约束；
新增 dsh 工具默认被排除，安全默认方向正确。浏览器实例按会话复用（请求 1 开页、
请求 2 截图共享实例），会话销毁时宿主触发 `onSessionEnd`（见 §4.5）显式释放。

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
| `deliverable`（AppDeliverableContract） | 工厂期 | finish_task 终态语义：工具描述 / 拒绝文案 / 收尾指令 / 证据标记（如 `["```ginkgo", "PlanReviewCard"]`） |
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

### 4.4 应用动作分发网关（dispatchAction）

工作台/设置分区等前端交互指令走统一网关 `POST /api/apps/[appId]/action`：宿主薄壳
完成白名单校验 → 会话归属权校验（防跨会话越权）→ 沙箱路径安全归一化 → 委托应用
`dispatchAction(action, payload, ctx: AppActionContext)`。应用侧按 action 字符串
分发（命令分发模式），返回值直接 JSON 回包；未实现该接缝的应用网关返回 501。
范例见 `app-general/src/server/index.ts` 的 `browser_status` /
`browser_capture_screenshot`。

### 4.5 会话终止钩子（onSessionEnd）

宿主删除会话（`DELETE /api/sessions/:id`）成功后触发 `onSessionEnd(sessionId)`，
应用据此释放会话级资源（浏览器实例缓存、长驻服务等）。清理失败由宿主吞错，不阻塞
删除响应；未声明该接缝的应用无需实现。约定：跨请求需要复用的资源（如同一会话的
浏览器实例）**不要**在 `getTools` 里释放，只在 `onSessionEnd` 释放。

### 4.6 底层能力声明（requiredCapabilities）

`requiredCapabilities` 声明应用依赖的平台底层能力，合法取值以 app-sdk 的
`KNOWN_APP_CAPABILITIES` 词汇表为唯一事实来源（workspace_sandbox / filesystem /
bash / browser / sql_query / chart_spec / methodology / claude_design /
claude_design_system）。组合根注册应用时逐项校验：未知能力 `console.warn`
**不拦截**——前向兼容第三方应用（新版应用可声明旧版平台不认识的能力），同时防
拼写漂移。新增底层能力时先扩充词汇表。

### 4.7 协议投影类型（跨层消息与结果契约）

- `AppWorkspaceMessage` / `AppWorkspaceToolInvocation`：宿主注入工作台插槽的
  `messages` 最小只读投影——应用侧据此解析工具调用流水（如浏览器 Tab 的操作
  时间线），禁止在应用内自行 `unknown` 窄化；
- `AppSessionDetailProjection`：宿主 `GET /api/sessions/:id` 响应形状的投影契约，
  应用经 HTTP 消费会话消息时与宿主同源标注；
- `toolFailure(toolName, message)` / `ToolFailureResult` / `isToolFailureLike`：
  「简单工具失败」结果的协议级工厂与守卫——能力包装层、编排安全切面、应用动作
  网关等生产方一律经工厂构造（error 带 `[toolName]` 前缀），宿主工具卡片经宽容
  守卫判定失败态。约定：**AbortError 必须在每层透传**，不得收敛为失败结果
  （取消语义优先于错误收敛）。命令级富结构失败（bash 的 exitCode/stdout 等）
  不适用本契约。

### 4.8 生命周期契约与健康检查（第三方应用必读）

应用可选声明安装/卸载/更新钩子与运行前健康检查。**归属原则**：凡是"这个应用依赖什么外部东西"，一律由应用自己声明或探测，平台层不做猜测。

```ts
// manifest.lifecycle（安装期钩子，服务端执行）
lifecycle: {
  onInstall?: (ctx: AppInstallContext) => Promise<{ success: boolean; message?: string }>;
  onUninstall?: (ctx: AppInstallContext) => Promise<void>;
  onUpdate?: (ctx: AppInstallContext, from: string, to: string) => Promise<void>;
}

// server.healthCheck（运行期健康检查，服务端专用）
server: {
  healthCheck: async (ctx) => ({
    healthy: false,
    status: "missing_deps",              // ready | degraded | missing_deps
    missingCapabilities: ["cli:my-cli"],
    remediationGuide: "npm install -g my-cli",
    message: "缺少 my-cli，导出功能不可用",
  }),
}
```

**为什么 `healthCheck` 放在 `server` 而不是 `manifest`**：manifest 会被客户端组件链引用，而 CLI 探测依赖 `node:child_process`；放进 manifest 会把 Node 内置模块拖进浏览器包。服务端入口才是它的归属。

- 宿主只判定**平台自身提供**的能力（`PLATFORM_PROVIDED_CAPABILITIES`：sandbox/filesystem/bash/browser/sql_query/chart_spec/methodology/duckdb）；
- 其余能力（外部 CLI/服务）宿主一律委托 `server.healthCheck`；若应用声明了非平台能力却没实现探测，`GET /api/apps` 会显示 `degraded` 并提示补齐——**不会由平台编造安装命令**；
- 第三方应用也支持在 `manifest.lifecycle.onHealthCheck` 实现，注册时会被适配到 `server.healthCheck`（运行时只有一条调用路径）；
- 健康检查结果在宿主侧缓存 30s，避免列表接口反复探测。

### 4.9 权限声明与工具门禁（权限模型 v1）

第三方应用若需要读取数据源、写工作区、执行命令等，必须显式申请权限，**未声明的工具不会被挂载（default deny）**。

```ts
manifest: {
  permissions: ["datasources.read", "workspace.write"],   // 申请
},
server: {
  toolPermissions: {          // 工具 → 所需权限（宿主据此过滤）
    sql_query: "datasources.read",
    write_file: "workspace.write",
  },
},
```

规则：

| 情况 | 宿主行为 |
| --- | --- |
| 未声明 `permissions`（平台内置应用） | 不过滤（零回归） |
| 声明了 `permissions` | 只放行「已声明 `toolPermissions` 且该权限在 `permissions` 内」的工具 |
| 工具没写进 `toolPermissions` | **丢弃**（default deny） |

安装时是**两段握手**：首次提交返回 `409` + 权限清单，用户在应用中心确认后带 `acknowledgedPermissions` 重试才会注册启用；确认结果留痕在 `config/apps.json`。包在确认前已下载但**不注册、不启用**。

### 4.10 打包与出口形态（当前形态）

平台**消费源码**（`exports` → `./src/*.ts`），由 Next 按**文件级** `"use client"` 划分 RSC 边界。`publishConfig` 里保留 `dist` 出口供未来发布使用，但仓内构建不依赖 `dist`。

> ⚠️ 不要改成"整包 bundle + 全局 `"use client"` banner"：实测会导致服务端组合根拿到的 `manifest` 变成 client reference（`app.manifest` 为 undefined，构建在 page data 收集阶段失败）；去掉 banner 则客户端 UI 依赖（recharts）进入 RSC 报 106 个错。发布形态见路线图「预打包发布」里程碑。

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
- **平台机制回归**：`packages/ginkgo-llm/src/handler.test.ts` + `evals/trajectories.test.ts`
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
- [ ] 外部依赖（CLI/服务）→ `server.healthCheck` 自治探测（不要指望平台知道你的命令名）
- [ ] 需要数据/沙箱/命令能力 → `manifest.permissions` + `server.toolPermissions` 成对声明
- [ ] `pnpm verify` 全绿（lint + typecheck + test + build）；prompt 变更跑一次 `pnpm eval:tier-b`

### 4.11 发布出口（npm 分发时的入口约定）

应用包在 npm 上**不暴露根入口**，而是按用途拆成显式子路径（避免消费方在服务端误 import 到含客户端组件的混合入口）：

| 子路径 | 内容 | 运行环境 |
| --- | --- | --- |
| `./manifest` | 纯元数据（`AppManifest`） | 服务端安全 |
| `./server` | 运行时能力（工具装配、prompt、动作分发） | 服务端 |
| `./definition` | 完整应用定义（manifest + client 契约数据 + 插槽组件） | 客户端（带 `"use client"`） |
| `./client` | 纯 UI 组件集合 | 客户端 |
| `./isomorphic/*` | 同构工具（如看板快照捕获） | 双端 |

```ts
// ✅ 服务端注册 / 能力协商
import { analyticsManifest } from "@ginkgolab/app-analytics/manifest";
import { createAnalyticsServer } from "@ginkgolab/app-analytics/server";

// ✅ 客户端渲染（需要 client 契约与插槽组件时）
import analyticsAppPackage from "@ginkgolab/app-analytics/definition";

// ❌ 根入口在发布形态下不存在（ERR_PACKAGE_PATH_NOT_EXPORTED）
import analyticsAppPackage from "@ginkgolab/app-analytics";
```
