# @openui-analytics/methodology

OpenUI Analytics 的方法论资产包：把通用分析思维定义为**方法卡纯数据**（内置 10 张），配套注册表合并与 prompt 渲染两套纯函数——app 侧推荐列表与 llm 包提示词注入都由这份数据驱动。

## 包定位与依赖

monorepo 中最「纯」的包：

- **零运行时依赖**：`package.json` 的 devDependencies 仅 typescript、vitest；`exports["."]` 直接指向 `./src/index.ts` 源码，随 monorepo 编译消费。
- **只做方法论资产定义**：卡是纯数据对象，不 import 任何组件、prompt 或运行时环境；编排代码对「有几张卡、是什么卡」零感知（`cards.ts` 顶部注释的原话）。
- **消费方**：
  - `packages/openui-llm/src/handler.ts`：`renderMethodIndex` 把方法索引注入 direct/plan 提示词，`renderCardDetail` 在 execute 模式按需注入单卡指导；
  - app 侧：`src/lib/methodologyLoader.ts` 启动组装应用方法论库，`src/components/chat/useMethodologyPresets.ts` 由 `presetQuery` 生成侧栏「推荐」列表，`src/app/api/methodology/route.ts` 提供方法论查看入口数据，`MethodologyModal.tsx` 展示卡集。

## 目录结构

| 文件 | 职责 |
|---|---|
| `src/types.ts` | `MethodCard` 卡契约与 `METHOD_ID_RE`（卡 id 规范） |
| `src/cards.ts` | 内置 10 张方法卡 `builtinMethodCards`（通用分析思维，全部映射既有组件库组件） |
| `src/registry.ts` | 注册表：`createMethodLibrary` 合并 builtin+custom；`validateCards` / `filterCardShape` 校验与容错跳过 |
| `src/render.ts` | prompt 渲染纯函数：`renderMethodIndex`（索引 ≤1KB）、`renderCardDetail`（单卡 ≤600B），按 UTF-8 字节预算硬截断 |
| `src/index.ts` | 统一入口，re-export 全部类型与函数 |
| `src/cards.test.ts` / `registry.test.ts` / `render.test.ts` | vitest（node 环境）三层覆盖 |
| `vitest.config.ts` | `environment: "node"`（纯数据与纯函数，无 DOM 依赖） |

## 架构

**方法卡模型（`src/types.ts` 的 `MethodCard`）**：

| 字段 | 语义 |
|---|---|
| `id` | 稳定 id，须匹配 `METHOD_ID_RE`（`/^[a-z][a-z0-9-]{0,39}$/`）；execute 阶段按 id 词边界匹配 PlanReviewCard 规划内容 |
| `name` | 方法名（中文，展示用） |
| `when` | 适用信号：一句话描述何时选这个方法 |
| `presetQuery?` | 一键带入的示例提问（领域中立措辞），**双重角色**：既是预设提问本身，也是推荐列表的数据来源——侧栏「推荐」直接从该字段生成，缺省则该卡不出现在推荐列表 |
| `steps` | 有序分析流程步骤 |
| `chartPairing` | 意图 → 组件库组件名（与 `@openui-analytics/components` 的 serverLibrary 键一一对应）；合法性由 `validateCards` 按**调用方注入的组件名集合**校验，本包零依赖、不反向依赖组件库 |
| `executeGuidance` | execute 模式注入的展开指导（预算 ≤600B 渲染截断）；图表类配对优先 `SpecChart`（语义声明图表，chartType 选型写在此字段） |

**注册表（`src/registry.ts`）**：`createMethodLibrary({ builtin, custom?, validComponentNames? })` 合并卡集——custom 同 id **覆盖** builtin（定制内置行为而非报错），builtin 保序、custom 追加；传入组件名集合走 `validateCards`（形态 + 组件名双重校验），否则走 `filterCardShape` 只做形态初筛；无效卡跳过并进 `skipped` 清单（`{ cardId, reason }`），沿用 config.ts 的容错哲学，不拖垮装配。产物 `MethodLibrary` 提供 `cards` / `find(id)` / `ids`。

**render（`src/render.ts`，仅服务端消费——用 Node `Buffer` 算字节）**：

- `renderMethodIndex(cards)`：direct/plan 模式常驻索引，每卡一行 `- id: name — when`，预算 `INDEX_BUDGET_BYTES = 1024`；超预算保序截断并标注「（其余方法省略）」。
- `renderCardDetail(card)`：execute 模式单卡详情，结构为 `### Method id · name` + `When:` + `Charts:`（配对组件用 ` + ` 连接）+ 编号 steps + `Guidance:`，预算 `DETAIL_BUDGET_BYTES = 600`；超预算先逐步骤从尾部裁，仍超再截 Guidance。

**用户卡 JSON 装载契约（app 侧 `src/lib/methodologyLoader.ts`，三级扩展的第三级）**：启动读 `<cwd>/data/methodology/*.json`（按文件名排序装载；目录不存在 = 零卡，正常态非错误）→ 单文件支持「单卡对象」或「卡数组」两种形态 → JSON 解析失败或形态不完整的卡 `console.warn` 后跳过，**坏卡不阻塞启动** → `createAppMethodology()` 把用户卡作为 custom 与内置卡合并（同 id 覆盖），并返回 `userIds` 供查看入口判定卡来源。注意：运行时未传 `validComponentNames`，用户卡只做形态过滤，组件名错卡的兜底是渲染层 `ErrorBoundary`。

## 业务逻辑

**内置卡清单（10 张，`src/cards.ts`）**：

| id | 名称 | 适用场景（when） |
|---|---|---|
| `trend` | 趋势与同比环比 | 指标随时间如何变化？相比上期/去年同期是升是降？ |
| `pareto` | 构成与帕累托 | 头部因素贡献了多少？哪些是关键的少数（80/20）？ |
| `funnel` | 漏斗转化 | 多阶段流程中用户/需求在哪一步流失最多？ |
| `rfm` | RFM 分层 | 如何把用户/客户按价值与行为分层运营？ |
| `cohort` | 同期群留存 | 不同批次（注册月/首个购买月）的留存曲线有何差异？ |
| `anomaly` | 异常检测 | 指标是否有异常点/异常时段？偏离正常范围多少？ |
| `attribution` | 维度拆解归因 | 指标为什么涨/跌？哪个维度的变化贡献最大？ |
| `goal-gap` | 目标达成与差距 | 对照目标/预算/SLA 的达成度如何？缺口多大？ |
| `ranking` | 排名与头尾分析 | 谁/哪个表现最好最差？头尾差距有多大？ |
| `distribution` | 分布与离群 | 数值分布形态如何？是否存在离群值拉高/拉低均值？ |

**一张卡的完整链路（定义 → 推荐列表 / 提示词注入）**：

1. **定义**：`src/cards.ts` 静态声明，或用户在 `data/methodology/*.json` 放 JSON；
2. **装载**：app 启动 `createAppMethodology()` 合并内置 + 用户卡得 `MethodLibrary`（llm 侧未传 methodology 时也用 `createMethodLibrary({ builtin: builtinMethodCards })` 兜底组装）；
3. **推荐侧**：`useMethodologyPresets` 首帧用内置卡的 `presetQuery` 兜底渲染，挂载后拉 `/api/methodology` 的合并卡集覆盖——用户卡带 `presetQuery` 即自动出现在侧栏「推荐」；`MethodologyModal` 经同一接口展示卡集（`executeGuidance` 是 prompt 内部件，不进查看契约）；
4. **注入侧**：llm `handler.ts` 用 `renderMethodIndex` 把索引写进 direct/plan 提示词；execute 模式经 `buildMethodDetailsFromMessages` 从最近一条 assistant 消息（PlanReviewCard 规划）按卡 id 词边界或中文卡名匹配（≤2 张），`renderCardDetail` 注入展开指导；
5. **校验侧**：`packages/openui-llm/src/promptExamples.test.ts` 把 serverLibrary 组件名全集注入 `validateCards`，守护「内置卡 chartPairing ↔ 组件库」一致性（杜绝 methodology → llm 反向依赖）。

## 功能清单

| 导出 | 来源 | 说明 |
|---|---|---|
| `MethodCard`（类型） | `types.ts` | 方法卡契约 |
| `METHOD_ID_RE` | `types.ts` | 卡 id 正则 `/^[a-z][a-z0-9-]{0,39}$/` |
| `builtinMethodCards` | `cards.ts` | 内置 10 张卡 |
| `createMethodLibrary(input)` | `registry.ts` | 合并 builtin+custom（同 id 覆盖）→ `{ library, skipped }` |
| `validateCards(cards, names)` | `registry.ts` | 形态 + 组件名双重校验 → `{ valid, skipped }` |
| `filterCardShape(cards)` | `registry.ts` | 仅形态初筛（运行时静默版） |
| `MethodLibrary`（类型） | `registry.ts` | `{ cards, find(id), ids }` |
| `CardValidationIssue`（类型） | `registry.ts` | 跳过原因 `{ cardId, reason }` |
| `renderMethodIndex(cards, budget?)` | `render.ts` | 方法索引文本（默认 ≤1024B） |
| `renderCardDetail(card, budget?)` | `render.ts` | 单卡详情文本（默认 ≤600B） |
| `INDEX_BUDGET_BYTES` / `DETAIL_BUDGET_BYTES` | `render.ts` | 字节预算常量（1024 / 600） |

## 如何扩展

**新增内置卡**：在 `src/cards.ts` 往 `builtinMethodCards` 追加符合 `MethodCard` 的对象（id 合规、steps≥2、chartPairing 引用真实组件名）→ 同步更新 `cards.test.ts` 的「恰好 10 张」「PRD 配对表」断言 → 新卡自动进推荐列表与提示词索引，无需改任何编排代码。

**新增用户卡（免改代码，重启生效）**：在 app 工作目录建 `data/methodology/xxx.json`：

```json
[
  {
    "id": "seasonality",
    "name": "周期性分析",
    "when": "指标是否存在周内/季节性周期波动？",
    "presetQuery": "该指标是否存在明显的周内周期波动？峰值出现在哪几天？",
    "steps": [
      "按周内各天/各月分桶统计指标",
      "计算各桶相对整体均值的偏离",
      "柱状呈现周期形态，标注峰值与谷值"
    ],
    "chartPairing": ["AnalyticsChart", "InsightBox"],
    "executeGuidance": "Bucket by weekday/month, compare each bucket against the overall mean, and call out peak/trough patterns."
  }
]
```

字段与 `MethodCard` 一致；`presetQuery` 可省略（省略则只进提示词索引，不出现在推荐列表）；`id` 与内置卡相同即**覆盖**内置卡；坏 JSON 或缺字段的卡启动时 warn 跳过，不影响其余卡装载。

## 测试

vitest（node 环境），`pnpm --filter @openui-analytics/methodology test`：

- `cards.test.ts`：恰好 10 张且 id 唯一、符合 `METHOD_ID_RE`；字段完整（steps≥2、chartPairing≥1、guidance>40 字符）；每张卡都带 `presetQuery` 且不含具体数据源名（不得绑定 禅道/zentao/gitlab/jira）；chartPairing 均为 PascalCase；PRD 配对表抽查（trend→SpecChart、funnel→FunnelChart、cohort→ContributionHeatmap、attribution→FocusLayout+ComparisonLayout、goal-gap→GaugeProgress）；M1 接线：pareto 的 guidance 引导 SpecChart combo（末位指标 = 累计占比线）。
- `registry.test.ts`：`validateCards` 全合法 / 未知组件跳过并报原因 / 坏形态跳过三分支；`createMethodLibrary` 无 custom 全量装载 + find/ids、custom 同 id 覆盖 + 新 id 追加；内置卡对 20 个真实组件名的契约快照（`skipped` 为空、10 张全过）；`filterCardShape` 运行时初筛。
- `render.test.ts`：10 卡索引含标题与每卡一行且 ≤1KB；50 张卡超预算保序截断并标注「其余方法省略」；10 张内置卡详情均含完整分段且 ≤600B；超长卡逐步骤截尾仍守预算。
