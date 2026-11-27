# 底座架构

Ginkgo 是**智能体应用平台**（不是单一定制产品）。分层与依赖方向恒为单向：**壳 → 应用 → 能力 → 协议**（逆向与跨层禁止）。

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
│ L3 应用包 packages/apps/*（协议：ginkgo-app-sdk）               │
│  app-analytics：三模式 prompt / 数据源与跨源工具 / 方法卡 /      │
│                 看板产物域（收藏·物化·重放·模板，全自持）        │
│  app-design：体验设计工坊（画板 / 设计系统 Token 大盘）          │
│  app-general：沙箱+浏览器自动化工具 / ArtifactViewer 多维工作台  │
├────────────────────────────────────────────────────────────────┤
│ L2 能力包 packages/ginkgo-*                                     │
│  sandbox（沙箱原子工具+权限档）· datasources（直连+只读网关）    │
│  browser（Playwright 浏览器自动化+权限档+会话作用域）            │
│  components（看板组件库+渲染基建+UI 原语）· chart-spec（spec 契约）│
│  methodology（方法卡资产）· harness-core（通用 Agent 底座）      │
│  models（零依赖同构模型与 Provider 规范契约+元数据）            │
├────────────────────────────────────────────────────────────────┤
│ L1 编排层 ginkgo-llm（领域中立）                                 │
│  streamText + 模型链韧性 + StreamHub 流中继 + 三维熔断 +         │
│  上下文投影治理 + 四接缝（prompt/tools/deliverable/onTaskFinish）│
├────────────────────────────────────────────────────────────────┤
│ L0 协议层 ginkgo-app-sdk：契约唯一事实来源（类型 + defineApp）   │
└────────────────────────────────────────────────────────────────┘
               │ 模型输出 ```ginkgo 代码块
               ▼
        UiSpecRenderer 流式渐进渲染为可交互看板
```

## 包结构

| 包 | 门面 | 职责 |
| --- | --- | --- |
| `packages/ginkgo-app-sdk` | `defineApp` / `AppPackageDefinition` | **L0 协议层**：manifest、客户端插槽、服务端契约、产物协议、消息区扩展 |
| `packages/apps/app-analytics` | `createAnalyticsServer` | 智能数据分析师应用（深度应用）：三模式 prompt、schema 摘要、方法卡、跨源映射、数据源工具、看板产物域全自持 |
| `packages/apps/app-design` | `getDesignTools` | 体验设计工坊应用：多端响应式视觉画板 (iframe)、设计系统 Token 大盘与样式合规审计 |
| `packages/apps/app-general` | `getGeneralTools` | 通用智能助手应用：沙箱原子工具（ginkgo-sandbox）+ 浏览器自动化工具（ginkgo-browser）、ArtifactViewer 多维工作台（文件/Git/终端/浏览器 Tab） |
| `packages/ginkgo-sandbox` | `createSandboxTools` | 沙箱工作区能力包：四原子工具（read/edit/write/bash）+ explorer 只读增强预设、full/readonly 权限档、run_command env 白名单 |
| `packages/ginkgo-browser` | `createBrowserTools` / `buildBrowserPromptSection` | 浏览器自动化能力包：dsh-browser-view（Playwright）→ AI SDK Tool 适配、full/readonly 权限档（装配层 allowlist 裁剪）、core/all 工具集、会话作用域隔离、prompt 同源派生 |
| `packages/ginkgo-models` | `isReasoningModel` / `resolveContextWindow` / `findPreset` | **L2 契约与元数据**：零依赖同构模型包。Provider 预设目录、模型参数归一化、推理判定、动态 models.dev 目录合并与缓存、上下文容量规范 |
| `packages/ginkgo-chart-spec` | `parseDashboardSpec` / `applyJsonPatch` | DashboardSpec 2.0 声明式状态树 + RFC 6902 JSON Patch 引擎（zod-only） |
| `packages/ginkgo-harness-core` | `ContextEngine` / `createTerminationTool` / `MCPClientManager` | 通用 Agent Harness：上下文裁剪压缩、洋葱模型工具切面、任务生命周期断言、三维预算防跑飞、MCP 连接池、FinOps 台账 |
| `packages/ginkgo-datasources` | `createDatasourceManager` / `QueryGateway` | 结构化数据源直连 + QueryGateway 安全网关 + 只读守卫管线 + Schema Card + Certified Queries 语义层 |
| `packages/ginkgo-components` | `analyticsLibrary` | 看板规范展示组件库（24 组件）+ 渲染基建（UiSpecRenderer / DSL 校验器 / FilterBus）+ 共享 UI 原语 |
| `packages/ginkgo-llm` | `createAnalyzeHandler` | **领域中立** LLM 编排：模型链韧性、StreamHub 流中继、三维熔断、上下文投影治理、四接缝 |

宿主 `src/` 只保留：组合根装配、通用 UI 框架（会话流/消息时间线/设置中心）、API 薄壳路由（`analyze` / `dashboards` / `methodology` / `sessions` / `workspace` 等均为拆包转发）。

## 底座契约：插槽与能力

应用**声明**客户端插槽（宿主按声明渲染）、**实现**服务端接缝（宿主调用）、**消费**能力包工厂。完整契约见 [应用接入规范](/app-integration-guide)，摘要：

**客户端插槽**（`AppClientContract`）：`welcomeMessage`、`presetQueries` + `resolvePresetQueries`、`WorkspaceComponent` / `InputAccessoryComponent`、`sidebarTabs` / `sidebarQuickActions`、`dashboardToolbar`、`messageExtensions`、`workspaceView` / `workspaceMount`。

**服务端接缝**（`AppServerContract`）：`buildSystemPrompt` / `getTools` / `needsWorkspace` / `requiresDataTools` / `listArtifacts` / `refreshArtifact`；`ctx.mode`（direct/plan/execute）贯穿 prompt 与工具装配——plan 模式沙箱自动收敛为只读档。

**能力消费**：沙箱工具（`@ginkgolab/sandbox`）、浏览器自动化（`@ginkgolab/browser`）、数据源网关（datasources）、看板渲染（components + chart-spec）、方法卡（methodology）、`zodTool` 等底座设施（harness-core）。能力包不 import 应用与宿主，经协议层类型解耦。

## 渲染管线

模型输出 ` ```ginkgo ` 代码块 → `parseDashboardSpec` 校验（zod-only）→ `UiSpecRenderer` 流式渐进渲染 → FilterBus 跨组件联动 → RFC 6902 JSON Patch 增量更新。
