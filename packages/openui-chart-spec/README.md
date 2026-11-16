# @openui-analytics/chart-spec

DashboardSpec 2.0 声明式状态树 + ChartSpec 图表语义契约 + RFC 6902 JSON Patch 增量编辑引擎——monorepo 最底层的 zod-only spec 契约包。

## 包定位与依赖

- **monorepo 中的角色**:最底层 spec 契约层,只定义「看板长什么样、数据怎么取」的封闭词汇表,不含渲染与取数实现。被 `@openui-analytics/components`(`SpecChart`、`charts/registry.tsx`、`DashboardSpecRenderer.tsx`)与 `@openui-analytics/llm`(`src/serverLibrary.ts`)以 `workspace:*` 依赖;自身不依赖任何其他 workspace 包。
- **唯一运行时依赖 zod(4.6.5)**:LLM 输出不可信,一切 spec 必须经 zod 封闭词汇表 + 上限约束校验后才进入渲染/物化链路,schema 即文档、校验即解析;底层包不再引入第二个运行时依赖,保证契约层零膨胀。
- ESM(`"type": "module"`),`exports` 直接指向 `./src/index.ts` 源码,无独立构建产物。

## 目录结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 包入口 + ChartSpec(单图表)契约:封闭词汇表枚举、`CHART_SPEC_LIMITS` 上限常量、`ChartSpecSchema` 主契约、`parseChartSpec`/`specToGroupByAndMetrics`;尾部 `export *` 聚合另两个模块 |
| `src/dashboardSpec.ts` | DashboardSpec 2.0 状态树:queries/layout/widgets 三段 zod schema + `parseDashboardSpec`/`safeParseDashboardSpec` |
| `src/jsonPatch.ts` | RFC 6902 JSON Patch 引擎:指针解析(含原型链保护)、事务性原子应用 |
| `src/index.test.ts` / `src/dashboardSpec.test.ts` / `src/jsonPatch.test.ts` | vitest 契约测试,共 23 例 |

## 架构

契约自底向上三层组合:

```ts
ChartSpec         // 单图表:dims × meas × filters × chartType,chartType 是可换渲染器(换图不换数据)
WidgetSpec        // 看板部件:type(9 值枚举)+ queryBinding;chartSpec 字段经 z.lazy 复用 ChartSpec
DashboardSpec 2.0 // 状态树根:version "2.0" + metadata + queries + layout + widgets
```

- **声明式状态树而非命令式 DSL**:整个看板是一棵纯 JSON 树——LLM 一次生成完整 spec,后续交互(改标题、换图表类型、增删部件)不重发全量,而是用 JSON Patch 描述「当前树 → 下一棵树」的最小差异。树可序列化、可 diff、可回滚;渲染侧 `DashboardSpecRenderer` 只认这棵树,按 `switch (widget.type)` 分派到对应组件。
- **`queries` 与渲染解耦**:`QueryPipelineSpec`(`sourceId`/`sql`/`params`/`certifiedQueryId`/`cacheTtl`)声明取数,`QueryBinding` 按 `queryId` 绑定;部件拿不到数据时可用 `staticData` 兜底,或绑定 `chartSpec` 直接复用单图表契约。
- **jsonPatch 引擎职责**:`applyJsonPatch(document, patches)` 先 `deepClone` 再逐项应用,事务性原子——任一项失败即整体回滚返回原文档(`success: false`,`error` 标注失败在第几项)。patch 来自模型输出、按不可信输入处理:`parseJsonPointer` 拒绝 `__proto__`/`constructor`/`prototype` 路径段,防原型链污染。
- **两者配合**:spec 树是唯一文档,patch 是唯一增量变更通道——引擎保证「要么整组生效、要么原地不动」,消费方拿 `result.doc` 重渲染即可(见 components 包 `DashboardSpecRenderer.test.tsx` 中「大模型 JSON Patch 增量微调」用例)。

## 业务逻辑

**spec 创建与校验**:
- 入口二选一:`parseDashboardSpec(input)`(`Schema.parse`,非法抛 zod 错误)或 `safeParseDashboardSpec(input)`(返回 safeParse 结果,不抛错);单图表走 `parseChartSpec(input)`,非法返回 `null`。
- 解析即补默认值:`layout.columns=12`、`gap=4`、栅格项 `colSpan=12`、`queries` 缺省 `{}`;`version` 必须字面量 `"2.0"`。
- `ChartSpecSchema` 的 `superRefine` 跨字段拦截:pie/donut 仅单指标;scatter 恰好 2 指标;filters 的 `op` 与 `value` 形态配套(`between` → `[number, number]`,`in` → 非空字符串数组,其余标量 string|number)。
- 词汇表全部封闭、无任意表达式注入面:chartType 11 种、聚合 5 种、过滤算子 9 种、语义色 4 种(禁止裸色值,映射应用层 token);字段名须过 `FIELD_RE`,`sourceId` 须过 `SOURCE_ID_RE`。
- `CHART_SPEC_LIMITS` 是上限唯一事实来源(dims≤3、meas≤12、filters≤8、thresholds≤4、referenceLines≤3、limit≤10 000、label≤60),与 app 侧 `src/lib/transforms.ts` 的 `TRANSFORM_GROUP_BY_MAX`/`TRANSFORM_METRICS_MAX`/`TRANSFORM_LIMIT_MAX` 数值对齐。

**patch 应用与边界处理**(全部在 `applyJsonPatch` → 私有函数 `applySinglePatch` 内):
- 已实现 `replace`/`add`/`remove`/`test` 四种 op:数组按索引(`add` 支持 `"-"` 尾追加、索引限 0..length;`replace`/`remove` 限已有索引,越界报「数组索引越界」),对象按 key。
- 中间路径不存在:`add` 自动补空对象继续下钻;其余 op 报「路径不存在」;在标量上继续索引报「路径不可达」。
- 空路径(`""` 或 `"/"`)即根操作:仅允许 `replace` 且 `value` 必须是对象(整文档置换),其他 op 与非对象 value 均失败。
- `test` op 以 `JSON.stringify` 深比较,可作破坏性变更的前置断言,失败即中止整组。
- `move`/`copy` 在 `JsonPatchOp` 类型中但引擎未实现,运行时报「暂不支持的 Patch 指令」(`JsonPatchOperation.from` 为其预留)。
- 所有失败路径返回原入参文档——操作只发生在克隆体上,原文档永不就地修改。

## 功能清单

| 导出 | 签名要点 | 用途 |
|---|---|---|
| `parseDashboardSpec` | `(input: unknown) => DashboardSpec`,抛错 | 严格解析 DashboardSpec 2.0 |
| `safeParseDashboardSpec` | `(input: unknown) => SafeParseReturnType` | 容错解析,不抛错 |
| `parseChartSpec` | `(input: unknown) => ChartSpec \| null` | 非法返回 null,LLM 链路容错惯例 |
| `specToGroupByAndMetrics` | `(spec: ChartSpec) => { groupBy: string[]; metrics: Record<string, AggregateFn> }` | dims→groupBy、meas→metrics,供 TransformSpec 投影 |
| `applyJsonPatch` | `<T extends object>(document: T, patches: JsonPatchOperation[]) => JsonPatchResult<T>` | 事务性原子应用 patch 组 |
| `parseJsonPointer` | `(path: string) => string[]` | JSON Pointer 解析(`~1`→`/`、`~0`→`~`)+ 原型链保护 |
| `deepClone` | `<T>(obj: T) => T` | 结构深拷贝 |
| `ChartSpecSchema` / `DashboardSpecSchema` / `WidgetSpecSchema` 等 | zod schema | 直接消费或组合扩展 |
| `CHART_TYPES` / `AGGREGATE_FNS` / `FILTER_OPS` / `SEMANTIC_COLORS` / `TIME_GRANULARITIES` / `MEASURE_FORMATS` | `as const` 数组 | 封闭词汇表 |
| `CHART_SPEC_LIMITS` / `FIELD_RE` / `SOURCE_ID_RE` | 常量 | 上限与命名规则唯一事实来源 |

类型导出:`ChartSpec`、`ChartType`、`AggregateFn`、`FilterOp`、`SemanticColor`、`DashboardSpec`、`WidgetSpec`、`QueryPipelineSpec`、`QueryBinding`、`DashboardLayout`、`JsonPatchOp`、`JsonPatchOperation`、`JsonPatchResult<T>`。

## 如何扩展

**新增部件类型**:在 `src/dashboardSpec.ts` 的 `WidgetSpecSchema.type` 枚举追加值 → 在 components 包 `DashboardSpecRenderer.tsx` 的 `switch` 加渲染分支 → 需要暴露给 LLM 时同步 `@openui-analytics/llm` 的 schema。
**新增 chartType**:`src/index.ts` 的 `CHART_TYPES` 追加值 → 在 components 包 `charts/registry.tsx` 注册渲染器(注册表按 `CHART_TYPES` 全枚举闭合);数据语义与图形解耦,物化侧无需改动。
**新增 patch op**:在 `src/jsonPatch.ts` 的 `applySinglePatch` 的 `switch` 加 case;任何非法输入直接 `throw`,保持「克隆体上操作、失败即整体回滚」的原子语义。
**调整上限/校验**:只改 `CHART_SPEC_LIMITS` 或 `ChartSpecSchema.superRefine`;注意与 app 侧 `src/lib/transforms.ts` 的 `TRANSFORM_*_MAX` 常量保持数值同步。

## 测试

`pnpm test`(vitest run;node 环境,纯 schema 契约包无 DOM 依赖),3 文件 23 例:

| 文件 | 覆盖行为 |
|---|---|
| `src/jsonPatch.test.ts`(8 例) | 指针解析(转义/空路径)、replace/add/remove/test、中间失败整体回滚、原型链保护(文档与全局原型均未污染)、根路径仅 replace、数组索引越界与非整数拒绝 |
| `src/dashboardSpec.test.ts`(2 例) | 合规 spec 解析、`version` 非 `"2.0"` 拒绝 |
| `src/index.test.ts`(13 例) | 全部 chartType 枚举、完整字段、上限值边界、封闭词汇表拒绝(非法聚合/算子/裸色值)、pie/donut 与 scatter 指标数约束、op/value 配套、`parseChartSpec` 容错、`specToGroupByAndMetrics` 投影 |
