# @ginkgolab/app-analytics · 智能数据分析师

Ginkgo 平台的**深度应用**范例：多源数据探查、指标计算、深度归因与敏捷可视化大屏。
完整接入规范见 [docs/app-integration-guide.md](../../../docs/app-integration-guide.md)。

## 包结构

- `src/manifest.ts` — manifest + 客户端插槽声明：AnalysisCanvas 工作台（`workspaceView: "canvas"`）/ SourcePicker 输入挂件 / 看板+推荐侧栏 / 方法论快捷动作（`Component` 弹层）/ `settingsSections`（跨源映射设置分区）/ `dashboardToolbar`（看板操作能力）/ `messageExtensions`（规划确认 + 终态总结卡 + 过渡文案）/ `resolvePresetQueries`（方法卡合并集）
- `src/client/` — 插槽组件与自持 UI：AnalysisCanvas / SourcePicker / MethodologyModal / CrossSourceSettings（设置中心应用分区，读写 `/api/cross-source`） / `methodologyPresets.ts`（推荐 resolver，拉 `/api/methodology` 合并卡集）
- `src/methodology/` — 方法论资产（自持，原 `packages/ginkgo-methodology` 并入）：`builtinMethodCards` 10 张内置卡 + 用户卡契约 + 注册表合并 + 字节预算受限的 prompt 渲染纯函数
- `src/isomorphic/` — **client-safe 领域层**（零 node/零 React）：声明式变换管线（transforms）、时间宏引擎（timeMacros）、查询行提取（queryRows）、活看板捕获（dashboardCapture）、快照导入导出（dashboardSnapshot）、记录类型（dashboardTypes）。宿主消息区收藏链路与本包服务端共用
- `src/server/` — **运行时全量**：`createAnalyticsServer(deps)` 工厂（宿主组合根注入 datasources / methodology / certified / crossSource / artifacts 五类依赖）+ **看板产物域**（收藏存储 dashboardStore / SQL 物化 specMaterialize / 活看板重放 dashboardRefresh / 筛选联动 distinctValues / 模板重绑定 templateRetarget / 厚路由编排 dashboardRoutes）+ 方法卡装配（methodologyLoader）
- `src/prompt.ts` — 三模式 System Prompt 文案（direct/plan/execute）
- `src/evals/` — Tier B 真实模型评测（`pnpm eval:tier-b`，缺 Key 自动跳过）

## 服务端自治能力（从编排层下沉）

| 模块 | 职责 |
| --- | --- |
| `server/prompt.ts` | 三模式 System Prompt + schema 摘要段 + 认证口径段 + 方法索引/详情 + 跨源规则段 + few-shot |
| `server/schemaDigest.ts` | 启用源结构卡摘要（8KB 总预算，按提问相关度展开） |
| `server/methodSelector.ts` / `planExtractor.ts` | 方法卡详情注入 + plan 轮 PlanReviewCard.methods 提取（pendingPlan 交接） |
| `server/methodologyLoader.ts` | 用户方法卡运行时装配（`data/methodology/*.json` 合并内置）+ 查看契约组装（`buildMethodologyOverview`，宿主 `/api/methodology` 薄壳消费） |
| `server/crossSource.ts` | 跨源映射注册表（`config/cross-source-map.json` 驱动，mtime 热加载 + 校验/原子写）+ `cross_source_link` 工具 |
| `server/crossSourceRoutes.ts` | `/api/cross-source` 厚路由编排（清单读取/整份替换，宿主薄壳转发） |
| `server/dashboardStore.ts` | 看板收藏存储（单记录单 JSON、原子写入、活看板字段校验） |
| `server/specMaterialize.ts` / `dashboardRefresh.ts` | ChartSpec 零 LLM 物化 + 活看板查询重放引擎（sql 只读守卫 / tool 只读白名单） |
| `server/distinctValues.ts` / `templateRetarget.ts` | 筛选联动取数 / 模板换源重绑定 |
| `server/dashboardRoutes.ts` | 厚路由编排（`handlePreviewQuery` / `handleCreateFromTemplate`，datasources+store 经 deps 注入，宿主 `/api/dashboards/*` 薄壳转发） |
| `server/index.ts` | 统一出口：工厂 + 产物服务（listArtifacts/refreshArtifact）+ 交付物契约 + 产物域/方法卡全部导出 |

静态包导出（`analyticsAppPackage`）只携带元数据（**主入口 client-safe**，不得引入
server 模块——datasources 依赖含 DuckDB 原生绑定）；运行时逻辑经宿主组合根
（`analyticsRuntime.ts` / `runtimeServers.ts`）装配。

## 产物协议

看板收藏（`type: "dashboard"`）实现平台产物协议：`appId` 归属、`listArtifacts`
枚举、`refreshArtifact` 活看板零 LLM 刷新（查询重放 + transforms 重算 + SpecChart
物化，compute-only，持久化在平台薄壳路由）。


## License

MIT © 2026 Ginkgo contributors — 完整条款见包内 `LICENSE`（或仓库根 `LICENSE`）。
