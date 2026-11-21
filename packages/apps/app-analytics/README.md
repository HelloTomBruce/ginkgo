# @openui-apps/analytics · 智能数据分析师

OpenUI 平台的**深度应用**范例：多源数据探查、指标计算、深度归因与敏捷可视化大屏。
完整接入规范见 [docs/app-integration-guide.md](../../../docs/app-integration-guide.md)。

## 包结构

- `src/manifest.ts` — manifest + 客户端插槽（AnalysisCanvas 工作台 / SourcePicker
  输入挂件 / 看板+推荐侧栏 / 方法论快捷操作）
- `src/client/` — 插槽组件与自持 UI 原语（`ui/`，不穿透宿主）
- `src/server/` — **运行时工厂** `createAnalyticsServer(deps)`（宿主组合根注入
  datasources / methodology / certified / crossSource / artifacts 五类依赖）
- `src/evals/` — Tier B 真实模型评测（`pnpm eval:tier-b`，缺 Key 自动跳过）

## 服务端自治能力（从编排层下沉）

| 模块 | 职责 |
| --- | --- |
| `server/prompt.ts` | 三模式 System Prompt（direct/plan/execute）+ schema 摘要段 + 认证口径段 + 方法索引/详情 + 跨源规则段 + few-shot |
| `server/schemaDigest.ts` | 启用源结构卡摘要（8KB 总预算，按提问相关度展开） |
| `server/methodSelector.ts` / `planExtractor.ts` | 方法卡详情注入 + plan 轮 PlanReviewCard.methods 提取（pendingPlan 交接） |
| `server/crossSource.ts` | 跨源映射注册表（`config/cross-source-map.json` 驱动）+ `cross_source_link` 工具 |
| `server/index.ts` | 工厂：getTools（数据源工具装配/降级）+ buildSystemPrompt + onTaskFinish + 产物服务（listArtifacts/refreshArtifact）+ 交付物契约导出 |

静态包导出（`analyticsAppPackage`）只携带元数据；运行时逻辑经宿主
`src/lib/analyticsRuntime.ts` 装配。平台渲染基建（serverLibrary / OpenUIRenderer /
DSL 校验器）在 `@openui-analytics/components`。

## 产物

看板收藏（`type: "dashboard"`）实现平台产物协议：`appId` 归属、`listArtifacts`
枚举、`refreshArtifact` 活看板零 LLM 刷新（查询重放 + transforms 重算 + SpecChart
物化，compute-only，持久化在平台路由）。
