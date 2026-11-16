# @openui-analytics/components

OpenUI 规范展示组件库：24 个 `defineComponent` 组件 + 图表注册表/筛选总线/容错基础设施，
经 `createLibrary` 聚合为 `analyticsLibrary`，由 app 侧 `<Renderer library={analyticsLibrary}/>` 渲染。

## 包定位与依赖

- **定位**：本包是「看板长什么样」的唯一渲染层——纯展示组件、布局模板与容错兜底都在这里；
  「取数与分析」不在此包（由 app 侧 `src/lib/specMaterialize` 等承担）。
- **依赖**：
  - `@openui-analytics/chart-spec`（workspace 包，目录 `packages/openui-chart-spec`）：`ChartSpec`
    语义图表契约（`CHART_TYPES`/`dims`/`meas`/`filters`/`style`）与 `DashboardSpec` 2.0 声明式
    状态树 schema（含 RFC 6902 JSON Patch 引擎 `jsonPatch.ts`）；
  - `@openuidev/react-lang`：`defineComponent` / `createLibrary` / `<Renderer>` /
    `useTriggerAction` / `useSetFieldValue`（action 与状态通道）；
  - `recharts`：全部统计图渲染底座；`zod`：props schema；`lucide-react`：图标。
- **被消费方**（app 侧 `src/`）：
  - `OpenUIRenderer.tsx`：`<Renderer library={analyticsLibrary}/>` 渲染 LLM 产出的 OpenUI DSL，
    并复用本包 `ErrorBoundary` 做顶层兜底；
  - `ComponentCatalogModal.tsx`：消费 `componentCatalog` + `componentDemos` 做「可视化组件」目录
    与实况预览（预览也走 `<Renderer library>` 同一渲染路径）；
  - `AnalysisCanvas.tsx`：消费 `DashboardScopeProvider` 为每块看板划分筛选作用域；
  - `clientTools.ts`：复用 `toCsvContent` / `downloadCsv`（toast 封装在 app 侧，组件包不依赖）；
  - `dashboardCapture.ts`：用 `analyticsLibrary.toJSONSchema()` 生成解析器做看板快照。
- **不依赖 app 侧状态**（toast、路由、session 等）；需要 app 能力时通过
  `@openuidev/react-lang` 的 action 流（`useTriggerAction` 等）上抛，或 fetch 包内约定的
  app API（`/api/dashboards/preview-query`、`/api/datasources/:sourceId/distinct`）。

## 目录结构

| 目录/文件 | 职能 | 组件/设施 |
|---|---|---|
| `src/layout/` | 布局与模板 | `Root`（根容器）、`MetricGrid`（栅格）+ 5 个模板：`ReportLayout`（报表）、`FocusLayout`（深钻）、`ComparisonLayout`（对比）、`MonitoringLayout`（监控巡检）、`CohortRetentionLayout`（留存队列） |
| `src/metrics/` | 指标类 | `MetricCard`、`GaugeProgress` |
| `src/charts/` | 图表类（recharts） | `AnalyticsChart`、`SpecChart`、`ComboChart`、`FunnelChart`、`RadarChart`、`ContributionHeatmap`；共享基建 `registry`（图表注册表）、`chartShared`（色板/系列解析/阈值着色）、`filterBus`（筛选联动总线） |
| `src/data/` | 数据明细 | `DataTable`、`RankingList` |
| `src/insight/` | 洞察结论 | `InsightBox`、`ActionPlanCard` |
| `src/timeline/` | 时间线 | `ActivityTimeline` |
| `src/interaction/` | 交互控件 | `AnalyticsFilterBar`、`ActionButton`、`ReactiveSimulator`、`PlanReviewCard` |
| `src/spec/` | 声明式渲染容器 | `DashboardSpecRenderer`（DashboardSpec 2.0 → 栅格看板） |
| `src/internal/` | 内部支撑（不承诺稳定） | `ErrorBoundary`、`ComponentSafeWrapper`、`layoutZone`、`parseProp`、`csv`、`niceScale` |
| `src/index.ts` | 聚合出口 | `CATALOG_GROUPS`（组件注册唯一事实来源）、`analyticsLibrary`、`componentCatalog`、共享基建再导出 |
| `src/componentDemos.ts` | 目录演示样例 | 组件名 → OpenUI DSL 片段（目录弹窗实况预览用） |

## 架构

**三层设计**，每个展示组件由同文件内的两样东西构成：

1. **纯 React 组件**：可脱离 OpenUI DSL 直接在页面中使用（如 app 侧直接 import `MetricCard`）；
2. **OpenUI 定义**：`XxxYyyDef = defineComponent({ name, description, props, component })`——
   `props` 是 zod schema（对 LLM 的宽松契约），`component` 是「props 收敛函数 + 渲染」，
   负责把任意形态的 LLM 输出收敛成强类型 React props；
3. **`createLibrary` 聚合**：`src/index.ts` 的 `CATALOG_GROUPS` 按 7 个分类登记全部 24 个 Def，
   `analyticsLibrary = createLibrary({ components, root: "Root" })`——library 渲染清单与
   `componentCatalog` 展示目录都从这份数据派生，新增组件只登记一次。

**单组件故障隔离**：所有 Def 的渲染统一包在 `<ComponentSafeWrapper name="XxxYyy">` 内，
其内部就是共享 `ErrorBoundary`：单组件数据异常降级为警告卡，不拖垮整个看板；
`ErrorBoundary` 以 `resetKey`（内容标识）变化触发自愈复位——流式渲染的中间态解析失败
可在后续 token 到达时自愈，相同 props 则保持错误态（重试必然再失败，复位只会循环）。

**layoutZone 的区块渲染机制**：布局模板的每个 zone 经 `renderSafeLayout(name, fn, renderNode)`（`internal/layoutZone`）
执行——它创建 `createSafeZone` 生成的 `zone(value, slotName)` 插槽解析器，内部调用库注入的
`renderNode` 把子组件 AST 物化为 React 节点：严格判空（未提供的 zone 不渲染占位）、
捕获单个 zone 的解析/物化异常并就地降级为「某某区块解析失败」提示卡（防静默吞错、防冒泡死循环），
整个模板再包一层 `ComponentSafeWrapper`。

**spec/ 与 chart-spec 包的配合**：`spec/DashboardSpecRenderer.tsx` 是 DashboardSpec 2.0 的
声明式状态树渲染容器（数据-视图分离）：输入 `DashboardSpec`（`metadata` + `layout` 栅格 + `widgets`
字典）与 `dataStore`（queryId → 行数据），按 `layout.rows` 的栅格声明逐 widget 派发到
内部 `RenderWidget` 分发器（支持 MetricCard / AnalyticsChart / ComboChart / DataTable /
FunnelChart / GaugeProgress / RankingList / InsightBox / SpecChart 九类）；数据解析优先
`queryBinding.queryId` → `dataStore`，回退 `widget.staticData`；`metadata.themeTokens`
注入为 CSS 变量支持品牌定制。widget 内嵌 `SpecChart` 时进一步消费 chart-spec 的
`ChartSpec` 契约。该 schema 与 RFC 6902 JSON Patch（`chart-spec/src/jsonPatch.ts`）天然咬合，
支持对状态树做增量编辑而非整树重生成。注意：`DashboardSpecRenderer` 目前仅由本包导出
（含测试），app 侧尚未接线。

**props schema 宽松容错与 LLM 流式半成品兜底**：组件侧 props schema 一律 `z.any().optional()`
（只写 `describe` 说明语义），因为流式渲染时 LLM 输出是逐 token 到达的半成品，强 schema
会在中途反复报错；真正的强约束在 `@openui-analytics/llm` 的 `serverLibrary.ts`（服务端
`defineComponent` 用 `z.string()` / `z.array()` / `z.enum()` 精确约束，供 prompt 的
JSON Schema 生成）。运行时收敛由两类机制兜底：`parseArrayProp`（`internal/parseProp`）
把真数组 / JSON 字符串 / 垃圾值统一收敛为对象数组；各 Def 的 `component` 收敛函数逐字段
做 `String()` / 枚举白名单 / 数值校验（如 `MonitoringLayout` 的 status 三值收敛、
`SpecChart` 对 LLM 误把 height 传到第三位的容错）。即「渲染侧宽松、prompt 侧强约束」的双层策略。

## 布局模板

布局组件作为模板概念：嵌在 `Root` 内、按命名区块（zone）组织内容，LLM 按场景选择。
不套模板时 = Root 垂直平铺（默认，向后兼容）。

- `ReportLayout(title, subtitle?, controls?, kpis?, charts?, detail?, insights?)` — BI 报表：
  页头 + 控制筛选区 + KPI 横排（移动 2 列 / 桌面 4 列栅格，直接传 MetricCard 数组，
  勿再嵌 MetricGrid）+ 双列图表（奇数个时末张占满整行）+ 全宽明细 + 结论区。
  适用于周期性综合复盘。
- `FocusLayout(title, subtitle?, controls?, main, side?, detail?)` — 深钻归因：
  主图区（2/3 宽，无侧栏时占满）+ 侧栏洞察（1/3 窄列）+ 底部明细。适用于单一主题根因分析
  （“为什么 X 上升/下降”）。
- `ComparisonLayout(title, subtitle?, controls?, leftLabel, left, rightLabel, right, verdict?)` —
  左右对比：带对比对象标签的双栏面板（左蓝/右紫，标签缺失降级“左/右”）+ 底部结论区。
  适用于 A/B 或两实体（渠道/仓库/成员/版本）对比。
- `MonitoringLayout(title, subtitle?, controls?, status?, statusBanner?, anomalies?, details?, actions?)` —
  监控巡检与告警排查：页头带健康状态徽标（`status`: `normal`/`warning`/`critical`，
  非法值收敛为 normal）+ 状态横幅 + 异动指标网格（同 KPI 4 列栅格）+ 异常明细
  （DataTable / ActivityTimeline）+ 应急处置（ActionPlanCard / ActionButton）。
- `CohortRetentionLayout(title, subtitle?, controls?, kpis?, heatmapMatrix?, decayTrend?, verdict?)` —
  留存与队列流转：核心留存 KPI（次留/7留/30留）+ 队列留存热力矩阵（DataTable /
  ContributionHeatmap）+ 留存衰减曲线（AnalyticsChart / ComboChart）+ 归因结论。

**zone 语义约定**（Def 的 props `describe` 是同一份约定，LLM 靠它选对区块）：

- 各模板的 `controls` zone 统一放 `AnalyticsFilterBar` 等全局筛选；
- `FocusLayout` 的 `side` 仅放紧凑结论件（InsightBox / GaugeProgress / 单个 MetricCard 或
  MetricGrid）；ActionPlanCard / ActivityTimeline / DataTable 等内容密集组件必须归 `detail`；
- `ReportLayout` 的 `kpis` 直接传 MetricCard 数组（模板自排栅格），勿嵌 MetricGrid。

**与 llm 包的三处同步纪律**（新增/修改模板或 zone 时勿漏，三处任一漂移都会让 LLM 选错模板）：

1. `packages/openui-llm/src/serverLibrary.ts`：同名 server def（`serverReportLayout` /
   `serverFocusLayout` / `serverComparisonLayout` / `serverMonitoringLayout` /
   `serverCohortRetentionLayout`），description 写清适用场景（是 LLM 选模板的依据），
   props 用强 zod schema；
2. `packages/openui-llm/src/prompt.ts`：组件清单段落与 few-shot 示例同步模板签名与 zone 用法；
3. `packages/openui-llm/src/promptExamples.test.ts`：解析守护——few-shot 示例必须能被
   serverLibrary schema 无错解析，防止 prompt 与 schema 漂移。

## 主题与样式

- 颜色只用语义 token（`bg-card`、`text-foreground-subtle`、`bg-info-soft`、`text-success-fg`
  等）；app 的 `src/app/globals.css` 是唯一颜色事实来源，本包禁止硬编码色板类
  （`bg-slate-50`、`dark:text-blue-400` 等，eslint `no-restricted-syntax` 拦截）。
  globals.css 已通过 `@source` 覆盖本包全部源码，新目录无需额外配置。
- 图表色统一走 `chartShared` 的 `CHART_COLORS`（即 `var(--chart-1..6)`，globals.css 唯一定义），
  `var()` 引用直接透传进 recharts 的 SVG stroke/fill 属性，由浏览器端解析，SSR 无需兜底；
  条件样式/辅助线的语义色经 `SEMANTIC_SOLID` 映射（`success`/`warning`/`danger`/`info`
  → `var(--*-solid)`），阈值着色判定用 `thresholdCellFill`，指标格式化用 `formatMeasureValue`。
- 暗色模式跟随系统 `prefers-color-scheme`（globals.css 内覆写 token），组件侧不写 `dark:` 类。

## 如何新增一个展示组件

1. **按职能建文件**：在对应分类目录新建 `XxxYyy.tsx`（目录不存在就新建，
   并同步更新 `src/index.ts` 顶部注释与上表）。
2. **同一个文件里写两样东西**：
   - 纯 React 组件 `XxxYyy`（可独立在页面中使用，"use client" 开头）；
   - OpenUI 定义 `XxxYyyDef = defineComponent({ name, description, props, component })`，
     def 内统一用 `<ComponentSafeWrapper name="XxxYyy">` 包裹以隔离单组件故障。
   - props schema 保持宽松容错风格（`z.any().optional()` + 运行时收敛），
     供 LLM 流式半成品输出兜底；LLM 侧强约束在 `@openui-analytics/llm` 的 prompt/schema。
3. **注册一行**：`src/index.ts` 的 `CATALOG_GROUPS` 对应分组中 import 并加入该 Def——
   `analyticsLibrary` 渲染清单与 `componentCatalog` 目录自动同步（无需另改两处）。
4. **测试**：交互复杂的组件在旁建 `XxxYyy.test.tsx`（jsdom + @testing-library/react）；
   需要目录预览的在 `src/componentDemos.ts` 补一行 OpenUI DSL 演示（没有演示的条目仅展示信息）。
5. **联动（勿漏）**：
   - `@openui-analytics/llm` 的 prompt/schema 若需让大模型知道新组件，同步更新其组件清单
     （serverLibrary def + prompt 清单/few-shot，见「布局模板」的三处同步纪律）；
   - 图表类新组件若要接入 SpecChart 的「换图不换数据」体系，需在 `src/charts/registry.tsx`
     注册渲染器，并保持与 chart-spec `CHART_TYPES` 全枚举闭合。

## 约定

- 组件不依赖 app 侧状态（toast、路由、session 等）；需要 app 能力时通过
  `@openuidev/react-lang` 的 action 流（`useTriggerAction` 等）上抛。
- 所有面向 LLM 输出的数组 prop 过 `parseArrayProp` 收敛；CSV 导出统一走 `internal/csv`
  （RFC 4180 转义 + 公式注入防护 + Blob 下载）。
- 筛选联动统一走 `charts/filterBus`：`AnalyticsFilterBar`（声明模式 `filterField`）广播
  `emitFilterChange`，`SpecChart` / `DataTable` / `AnalyticsChart` 订阅后自行切片或重物化，
  多看板并用 `DashboardScopeProvider` 划分作用域防串扰。
- 布局模板的 zone 渲染一律经 `renderSafeLayout` / `zone()`（`internal/layoutZone`），
  不直接裸调 `renderNode`。
- 双 Y 轴复合图刻度对齐统一走 `internal/niceScale`（`calculateDualNiceScales`），
  保证左右轴网格线 100% 对齐。
- `src/internal/` 不对外承诺稳定性；跨包复用只经 `src/index.ts` 的显式再导出。
