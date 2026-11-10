# 统计报表能力增强设计方案

> 版本：v0.3 · 2026-11-09
> 状态：**M1 语义层 ✅**（TASK-044~048）；**M2 交互层 ✅**（TASK-049~053）；**M3 资产层 ✅**（TASK-054~058）——设计全部落地
> M3 落地记录：MCP 源退化通道（spec.toolQuery + TransformSpec 投影）、注册表第二批（scatter/gauge/heatmap，CHART_TYPES 扩至 11）、模板库（kind/templateMeta + retargetTemplate + save-as-template/from-template 路由 + 侧栏接线）
> M2 落地记录：distinct 端点+TTL 缓存、thresholds/referenceLines 渲染、FilterBar 声明模式+filterBus、preview-query 图表级重物化端点
> 实现期设计偏离：①targets 编排由 filterBus 发布/订阅 + 订阅端字段匹配取代（M2-3）；②preview-query 取图表级声明 {sourceId,table,spec} 而非 dashboardId/dsl 贯穿（M2-4）；③chartPairing 保持组件级粒度，chartType 选型校验由 ChartSpecSchema 承担（M1-5）
> 背景：调研 DataEase 低代码大屏编辑器（`http://192.168.0.202:8100`，模板「全国电力情况概览」编辑页实测），提炼其报表能力模型，映射到本项目（AI 生成 OpenUI DSL 路线）的统计报表实现。
> 核心立场：**借鉴 DataEase 编辑器背后的「能力模型」（数据语义/图形/交互/资产四层），而非其拖拽交互形态**——本项目的「编辑器」是 LLM，要结构化的是 LLM 产出的数据结构。

---

## 1. 现状盘点

### 1.1 已有基建（本次设计的地基）

| 能力 | 位置 | 现状 |
|---|---|---|
| 组件库（19 个组件） | [packages/openui-components/src/index.ts](../packages/openui-components/src/index.ts) | 布局 3 模板 + MetricCard/Gauge + 图表 4 + DataTable + 洞察/时间线/交互 |
| 基础图表 | [AnalyticsChart.tsx](../packages/openui-components/src/charts/AnalyticsChart.tsx) | 仅 `line \| bar \| area \| pie`，recharts 渲染 |
| 声明式变换 | [src/lib/transforms.ts](../src/lib/transforms.ts) | `TransformSpec`：`aggregate(groupBy + metrics sum/avg/count/min/max) + compute + sort + limit`，封闭算子词汇表，可重放 |
| 生成期捕获 | [src/lib/dashboardCapture.ts](../src/lib/dashboardCapture.ts) | 工具调用 → `queries`/`bindings`/`transforms`，保守优先（derived 不绑定） |
| 零 LLM 刷新 | [src/lib/dashboardRefresh.ts](../src/lib/dashboardRefresh.ts) | 查询重放 + TransformSpec 重算 + DSL 回填，只读守卫/行数封顶 |
| 行属性映射 | [src/lib/queryRows.ts](../src/lib/queryRows.ts) | `ROW_PROP_BY_TYPE`：组件类型 → 行数组 prop 名 |
| 看板存储 | [src/lib/dashboardStore.ts](../src/lib/dashboardStore.ts) | DSL 快照 + `DashboardQuery`（sql/tool payload）+ origin，单文件落盘 |
| 报表布局 | [ReportLayout.tsx](../packages/openui-components/src/layout/ReportLayout.tsx) | 页头 + KPI 横排 + 双列图表 + 全宽明细 + 结论区（zone 语义已与 LLM 侧约定） |
| 筛选交互 | [AnalyticsFilterBar.tsx](../packages/openui-components/src/interaction/AnalyticsFilterBar.tsx) | `useSetFieldValue`/`useTriggerAction` 已通，但选项为演示级硬编码 |
| 方法卡配对 | [types.ts](../packages/openui-methodology/src/types.ts) `chartPairing` | 「意图 → 组件名」映射雏形，`validateCards` 校验存在性 |

### 1.2 关键判断

`TransformSpec` 的 `groupBy + metrics(聚合)` **已经是一个维度/指标模型的胚胎**——但它目前只活在「捕获/重放」侧（刷新时重算用），LLM 生成侧仍然直接产出图形渲染数据。本方案的主线是：**把这个语义模型前置为 LLM 的一等输出契约**，让生成、捕获、刷新三段共用同一语义。

---

## 2. DataEase 能力模型 → 本项目映射

| DataEase 能力（实测） | 本质 | 本项目落点 | 优先级 |
|---|---|---|---|
| 数据 tab：维度桶/指标桶 + 聚合方式（求和）+ 过滤器 + 钻取维度 | **数据语义与图形解耦**：图表 = 维度×指标×过滤 的投影 | 新增 `ChartSpec` DSL 语义组件（§4.1） | P0 |
| 「切换图表」下拉：换图形不动数据绑定 | 图形类型是语义之上的可换渲染器 | 图表注册表 + `chartType` 可切换（§4.2） | P0 |
| 40+ 图表类型 | 报表表达力的词汇表 | 分批扩充（§4.2，先 6 类高频） | P0/P1 |
| 查询组件：一个筛选器联动多图表 | 筛选状态 → 数据重查 → 多组件回填 | FilterBar 数据化 + 复用 dashboardRefresh（§4.3） | P1 |
| 高级 tab：条件样式 / 辅助线 | 阈值变色、均值/目标线 | 通用 `thresholds`/`referenceLines` prop（§4.4） | P1 |
| 模板中心：.DET2 快照换数据集即用 | 报表模板 = 布局快照 + 可重绑定的数据位 | 看板记录升级为可重绑定模板（§4.5） | P2 |
| 结果展示上限 / 刷新频率 | 图表级数据窗口与刷新策略显性化 | ChartSpec 声明 `limit`/`refreshInterval`（§4.6） | P1 |
| 样式分组（标题/图例/轴/标签/提示…） | 每图表统一的可开关样式分组 | 组件 prop 分组约定，走 globals.css token | P2 |
| 1920×1080 固定画布 + 图层管理 | 投屏大屏形态 | **不借鉴**，保持 ReportLayout 响应式路线 | — |

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ LLM 生成层                                                    │
│   prompt schema 新增 ChartSpec 契约（serverLibrary 下发）        │
│   方法卡 chartPairing 指向注册表中的 chartType                  │
├─────────────────────────────────────────────────────────────┤
│ 语义层（新增）                     ★ 本方案核心                  │
│   ChartSpec { dims, meas(agg), filters, sort, limit,          │
│               chartType, style { thresholds, refLines } }     │
│   ── 生成时是声明；物化后是 TransformSpec 的超集                │
├─────────────────────────────────────────────────────────────┤
│ 物化层（服务端，扩展现有）                                       │
│   ChartSpec → SQL 片段 / TransformSpec → rows                  │
│   复用：sqlGuard 只读守卫、行数封顶、applyTransform              │
├─────────────────────────────────────────────────────────────┤
│ 渲染层（组件库扩充）                                             │
│   图表注册表（chartType → 渲染器 + zod schema + 默认样式）        │
│   通用 thresholds / referenceLines / filterBinding            │
├─────────────────────────────────────────────────────────────┤
│ 资产层（扩展现有）                                               │
│   DashboardRecord + template 标记 + 重绑定（换源/换问法）         │
└─────────────────────────────────────────────────────────────┘
```

设计不变量（与 AGENTS.md 对齐）：

- **数据源零硬编码**：ChartSpec 只引用 `sourceId` 占位，能力开关仍由 `/api/datasources` 的 `features` 下发。
- **颜色唯一事实来源**：thresholds/条件样式的色值只能引用 globals.css 语义 token（`text-success-fg`、`bg-info-soft` 等），LLM 侧词汇表只暴露语义色名。
- **封闭词汇表**：ChartSpec 的 filter/agg/sort 沿用 transforms.ts 的白名单哲学，无任意表达式注入（compute 表达式继续走 `EXPR_SAFE_RE` 受限语法）。

---

## 4. 详细设计

### 4.1 ChartSpec：维度/指标语义契约（P0）

新增组件 `SpecChart`（packages/openui-components/src/charts/SpecChart.tsx），LLM 输出语义而非渲染数据：

```ts
// zod 契约（下发进 prompt schema；词汇表全部封闭）
const ChartSpecSchema = z.object({
  title: z.string().max(60).optional(),

  // 维度桶（对应 DataEase「类别轴/钻取维度」，对应 TransformSpec.groupBy）
  dims: z.array(z.object({
    field: z.string(),                     // 数据源字段名
    label: z.string().optional(),          // 展示名
    granularity: z.enum(["day","week","month","quarter","year"]).optional(), // 时间维度截断
  })).min(1).max(3),                       // 与 TRANSFORM_GROUP_BY_MAX 对齐

  // 指标桶（对应「值轴/指标(求和)」）
  meas: z.array(z.object({
    field: z.string(),
    agg: z.enum(["sum","avg","count","min","max"]),  // AggregateFn 同源
    label: z.string().optional(),
    format: z.enum(["number","percent","currency","compact"]).optional(),
  })).min(1).max(12),                      // 与 TRANSFORM_METRICS_MAX 对齐

  // 过滤器（对应 DataEase「过滤器」，静态声明；交互筛选见 §4.3）
  filters: z.array(z.object({
    field: z.string(),
    op: z.enum(["eq","ne","in","gt","gte","lt","lte","between","contains"]),
    value: z.union([z.string(), z.number(), z.array(z.string())]),
  })).max(8).optional(),

  sort: z.object({ key: z.string(), desc: z.boolean().optional() }).optional(),
  limit: z.number().int().max(10000).optional(),   // 结果展示上限（§4.6）

  // 图形类型 = 可换渲染器（对应「切换图表」）
  chartType: z.enum([
    "bar","stacked-bar","line","area","combo",   // 柱/条/线/面/柱线组合
    "pie","donut","scatter","table",             // 饼/环/散点/透视表
  ]),

  style: z.object({
    thresholds: z.array(z.object({               // 条件样式（§4.4）
      when: z.object({ field: z.string(), op: z.enum(["gt","gte","lt","lte"]), value: z.number() }),
      color: z.enum(["success","warning","danger","info"]),  // 语义色名 → token
    })).max(4).optional(),
    referenceLines: z.array(z.object({           // 辅助线
      value: z.number(), label: z.string().max(20).optional(),
      color: z.enum(["success","warning","danger","info"]).optional(),
    })).max(3).optional(),
    showLegend: z.boolean().optional(),
    showLabel: z.boolean().optional(),
  }).optional(),

  // 取数声明（生成期捕获复用 DashboardQuery 模型）
  sourceId: z.string().optional(),   // 缺省 = 当前唯一激活源；多源时必填
});
```

**物化管线**（服务端，`src/lib/specMaterialize.ts` 新增）：

```
ChartSpec
  ├─ 数据源为 SQL 类 → 生成参数化 SQL 片段（GROUP BY dims / 聚合 meas / WHERE filters）
  │     经 sqlGuard 只读校验后执行
  ├─ 数据源为 MCP 类 → 退化为「工具调用 + TransformSpec」：
  │     filters→工具参数（能映射时）；dims/meas/sort/limit → TransformSpec 由
  │     applyTransform 重算（复用现有重放链，零新引擎）
  └─ 产物 rows → 按 chartType 的注册渲染器投影为图形 props
```

**与既有三段的关系**：

- 生成：LLM 写 ChartSpec，token 成本低于直写渲染数据行（不再把几百行数据塞进 DSL）。
- 捕获：[dashboardCapture.ts](../src/lib/dashboardCapture.ts) 对 SpecChart 走「显式绑定」——spec 自带 sourceId+取数语义，不再依赖行匹配推测，消除当前「derived 保守不绑定」的一大类漏绑。
- 刷新：[dashboardRefresh.ts](../src/lib/dashboardRefresh.ts) 重放后按 spec 重投影，图表类型可中途被用户/LLM 改（只改 chartType，绑定不变）——这就是 DataEase「切换图表」的等价物。

### 4.2 图表注册表与词汇表扩充（P0/P1）

现状：`AnalyticsChart` 一个组件硬扛 `line|bar|area|pie`。改为**注册表模式**：

```ts
// packages/openui-components/src/charts/registry.ts
interface ChartRendererEntry {
  type: ChartType;                  // 与 ChartSpec.chartType 同枚举
  render: React.FC<ChartRenderProps>; // 入参统一为 {rows, dims, meas, style}
  zodSchema: z.ZodObject<any>;      // 该类型的增量约束（如 pie 要求 meas=1）
  defaultStyle: Partial<ChartStyle>;  // 走语义 token
  when: string;                     // 一句话选型信号，供方法卡 chartPairing 与 prompt 使用
}
```

分批落地（每批附带：渲染器 + schema + 测试 + prompt 示例）：

| 批次 | 类型 | 统计报表场景 |
|---|---|---|
| 第一批（P0） | stacked-bar、combo、donut、table(透视行) | 结构占比、双量纲对比、占比、明细 |
| 第二批（P1） | scatter、gauge(迁移 GaugeProgress 入注册表)、heatmap(迁移) | 相关性、KPI 达成、密度 |
| 第三批（P2） | funnel/radar 迁移入注册表，评估 waterfall | 转化、多维对比 |

方法卡联动：[types.ts](../packages/openui-methodology/src/types.ts) 的 `chartPairing` 从组件名改为注册表 `chartType`，`validateCards` 校验注册表存在性——新增图表类型即自动成为可配对项，与「新增方法卡即新增推荐项」同一哲学。

### 4.3 筛选器联动（P1）

借鉴 DataEase 查询组件「一器多图」，落到现有交互与刷新基建：

1. **选项数据化**：`AnalyticsFilterBar` 的 options 不再硬编码。LLM 在 DSL 中声明 `filterField: {sourceId, field}`，渲染期由 `/api/datasources/[id]/distinct?field=`（新增端点）拉取去重值（封顶 200，超了退化为输入框）。
2. **状态通道**：沿用 `useSetFieldValue` 写入筛选值；新增约定字段命名空间 `$filter.<name>`。
3. **重放联动**：筛选变化 → 客户端调 `/api/dashboards/preview-query`（新增，入参 = ChartSpec + 筛选值合并进 filters）→ 走 §4.1 物化管线返回 rows → `useSetFieldValue` 回填各绑定组件。**复用刷新链路的 SQL/Transform 双通道，不新取数引擎。**
4. 作用范围声明：FilterBar 增加 `targets: statementId[]`（缺省 = 同 ReportLayout 内全部 SpecChart），对应 DataEase 查询组件的「作用组件」勾选。

### 4.4 条件样式与辅助线（P1）

- 实现位置：注册表渲染层统一处理 `style.thresholds` / `style.referenceLines`（不进各图表组件重复实现）。
- 色值映射：`success|warning|danger|info` → `var(--chart-*)` / 语义 solid token，写进 SVG 属性（符合 AGENTS.md 图表颜色约定）。
- recharts 侧：`ReferenceLine` 原生支持辅助线；柱状/条形阈值变色按 cell 着色；表格阈值走单元格底色 token。

### 4.5 报表模板库（P2）

- `DashboardRecord` 增加 `kind: "favorite" | "template"` 与 `templateMeta: {abstractPrompt, slots: [{bindingKey, role: "source"|"filter", required}]}`。
- 「存为模板」入口：把一次优质输出的 DSL 快照 + queries + bindings 整体转模板。
- 「用模板新建」：选择模板 → 重绑定 sourceId（列出当前激活源，缺失源给出禁用态与提示，不做关键词嗅探）→ 以 `abstractPrompt` 为种子重新生成或直接换源重放。
- 与工作台「推荐列表」衔接：内置模板可由方法卡 + 示例 DSL 预置，推荐位渲染逻辑不变。

### 4.6 数据窗口与刷新策略显性化（P1）

- `ChartSpec.limit`：LLM 按场景声明（明细表 1000、图表 50），服务端物化时与引擎封顶取 min；超限在组件角标显示「已截断至 N 条」（仿 DataEase「结果展示」的可见性）。
- `refreshIntervalSec`（可选）：看板收藏后由前端定时调刷新路由；缺省不自动刷（现状不变，避免无意压源）。

---

## 5. 分阶段落地计划

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1 语义层** | ChartSpec 契约 + SpecChart 组件 + 物化管线（SQL 通道）+ prompt schema 下发 + 注册表第一批 4 类型 | 一句提问生成含 SpecChart 的报表；改 chartType 不换数据可重渲染；`pnpm test/lint/typecheck` 全绿 |
| **M2 交互层** | distinct 端点 + FilterBar 数据化 + preview-query 联动重放 + thresholds/referenceLines | 筛选器改动可无 LLM 刷新同页多图；KPI 阈值变色、图表辅助线可见 |
| **M3 资产层** | 模板标记/重绑定 + MCP 通道物化（TransformSpec 退化路径）+ 注册表第二批 | 收藏可转模板并换源复用；MCP 源报表同样可刷新；文档与方法卡配对更新 |

每个里程碑内按 incremental-implementation 小步落地：契约 → 服务端 → 组件 → prompt → 测试。

---

## 6. 风险与权衡

| 风险 | 缓解 |
|---|---|
| LLM 生成 ChartSpec 的字段名与真实源字段不符（幻觉字段） | 物化前用源 schema 校验字段存在性，不符时在 DSL 内回显错误占位而非静默空图（复用 ErrorBoundary 语义） |
| ChartSpec 与现有「直写渲染数据」组件并存导致双轨混乱 | SpecChart 为新增组件不改动既有组件；prompt 侧对报表场景优先引导 SpecChart，明细/静态场景仍可直写 |
| filters 注入 SQL 的注入面 | 全部参数化 + sqlGuard 只读 + 封闭 op 词汇表；MCP 通道只允许映射为工具参数或 TransformSpec |
| distinct 端点压源 | 结果缓存（源 id+field 为键，TTL 5min）+ 200 条封顶 |
| 模板重绑定的字段错位 | slots 声明 required 字段角色，重绑定时校验目标源具备同名字段，否则要求用户手动映射 |

---

## 7. 附：DataEase 调研证据

- 模板中心：19 分类 166 个模板卡片（`.template-item-main` 计数），接口 `/de2api/templateMarket/search`，缩略图 baseUrl 指向公网 CDN（内网环境不显示预览图）。
- 模板实体为本地 `/upload/*.DET2`（编辑页 URL `templateParams` 解码），模板应用不依赖公网。
- 编辑页实测：数据 tab（切换图表/维度/指标(求和)/钻取/过滤器/刷新频率/结果展示 1000）、样式 tab（所在位置/基础样式/标题/图例/背景/边框/标签/提示/横轴/纵轴）、高级 tab（功能设置/辅助线/条件样式/联动设置/跳转设置）、数据集面板（维度/指标分桶）、大屏配置（1920×1080/宽度优先/字体/背景）、图层 70 个。
