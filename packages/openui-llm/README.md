# @openui-analytics/llm

OpenUI 数据分析领域特化编排层：面向数据可视化与交互式规划场景，负责 Prompt 工程组装、服务端组件 AST 规范约束、多模式分发（Direct / Plan / Execute）与交付物分级适配；底层执行流、上下文治理、工具切面与流中继全量由通用底座 `@openui-analytics/harness-core` 驱动。

## 包定位

- **领域业务编排层**：位于宿主应用与通用 Harness 底座之间，专注于 OpenUI 数据分析与交互式看板的业务装配（提示词设计、可视化组件 Schema、规划卡交互、跨源关系拓扑与 AST 语法守卫）。
- **零基础设施重复建设**：本包不再自行实现通用的上下文压缩、Token 计量、工具拦截、双重终态状态机或流中继；所有基础设施能力均通过依赖注入调用 `@openui-analytics/harness-core`。
- **与兄弟包的依赖与协作关系**：
  - **依赖 `@openui-analytics/harness-core`**：驱动所有底层 LLM 执行管道、上下文剪枝引擎、工具遥测切面、终态守卫与 SessionStreamHub；
  - **依赖 `@openui-analytics/datasources`**：加载启用数据源的查询工具、Schema 结构卡摘要与 Certified 权威认证口径；
  - **依赖 `@openui-analytics/methodology`**：获取分析方法卡索引并在执行期精准注入操作规范；
  - **依赖 `@openui-analytics/chart-spec`**：引用可视化图表规范作为服务端组件属性的强类型校验基础；
  - **支撑 `@openui-analytics/components`**：提供与前端同名的 `serverLibrary` 组件定义并生成 Few-Shot 约束，确保模型产出符合前端组件库规范的 ````openui ```` DSL。

---

## 核心架构

编排层采用**领域装配 + 提示词工程 + 组件 AST 校验 + 底座执行引擎**的松耦合架构：

```
+-----------------------------------------------------------------------------------------------+
|                       createAnalyzeHandler (OpenUI 业务分析总成门面)                             |
|  - 模式路由分派 (direct / plan / execute)  - 意图模糊检测与引导反问  - 凭证守卫与流重连探测       |
+-----------------------------------------------+-----------------------------------------------+
                                                |
        +---------------------------------------+---------------------------------------+
        |                                                                               |
        v                                                                               v
+-------------------------------+                               +-------------------------------+
|     提示词工程系统 (Prompt)     |                               |   服务端组件与语法校验 (AST)    |
| - 模式变体 Prompt (PromptTiers)|                               | - serverLibrary (Zod 强类型)   |
| - 交付物分级适配 (Summary/Full)|                               | - docGenerator (DSL 文档派生)  |
| - 结构卡预算展开 (SchemaDigest)|                               | - OpenUIDslValidator (语法预检)|
| - 方法论卡注入 (Methodology)   |                               | - PlanReviewCard 交互契约     |
| - 权威认证口径 (Certified)     |                               | - 跨源拓扑映射 (CrossSource)  |
+---------------+---------------+                               +---------------+---------------+
                |                                                               |
                +-------------------------------+-------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
|                       装配并委托给 @openui-analytics/harness-core 执行底座                      |
|  - 上下文治理引擎 (ContextEngine: 保留 PlanReviewCard 豁免, 注入 OpenUI 数据分析摘要提示词)     |
|  - 工具切面管线 (ToolInterceptors: 注入遥测打点 TelemetryAspect, 挂载动态数据源前缀工具)       |
|  - 任务生命周期 (createTerminationTool: 注入交付物断言 DeliverableAssertion，防空跑完成)       |
|  - 资源防跑飞熔断器 (ExecutionBudgetController: 步数、Token 预算与超时熔断)                   |
|  - 高可用任务流中继 (SessionStreamHub: 服务端独立 Reader、多端广播重放与断线瞬时续接)           |
+-----------------------------------------------------------------------------------------------+
```

### 1. 业务编排门面（createAnalyzeHandler）
接收客户端 HTTP 请求，负责直接分析（`direct`）、方案规划（`plan`）与方案执行（`execute`）的三态路由分发；检测并拦截过于模糊的单词输入，下发引导性反问；将数据源工具与 MCP 客户端注入分析管道。

### 2. 提示词工程系统（Prompt Engineering）
- **多模式提示词分发**：直接分析模式强调快速产出结论与可视化；规划模式（`plan`）强调问题拆解、数据源选取与方法论卡匹配；执行模式（`execute`）严格遵循用户确认的交互卡参数；
- **交付物规格分级适配**：支持“仅核心结论摘要（Summary-Only）”与“深度多维大看板（Full Dashboard）”两种交付形态，避免用户仅需简要结论时强行产出数千字报告与重复看板；
- **结构卡与方法论受控注入**：受 8KB 严格总预算控制展开核心表字段，按需追加 `cross_source_link` 跨源联合查询工具与 Certified 认证口径约束。

### 3. 服务端组件规范与 AST 守卫（Server Library & Guardrails）
- **服务端组件库（`serverLibrary`）**：以 Zod 严格定义 `Root`、`MetricCard`、`BarChart`、`DataTable`、`FilterBar` 等可视化展示组件，作为反射生成 LLM 提示词说明的唯一事实来源；
- **语法校验器（`OpenUIDslValidator`）**：实现底座的 `StructureValidator` 接口，预先解析模型生成的 ````openui ```` 看板代码块，在代码落地前发现 AST 语法破损与缺失 Root 等异常。

### 4. 基于 Harness Core 的策略注入
本包作为消费者，向通用底层底座注入具体的业务策略：
- **消息保护策略**：注入 `isProtectedMessage`，确保最近一张 `PlanReviewCard` 即使在超长历史中也逐字豁免保留；
- **交付物断言契约**：向 `createTerminationTool` 注入交付断言，以 `hasVisualArtifact || totalTextChars > 0`（有图表组件或有实质文本分析）作为允许宣告 `completed` 的依据，防止空跑完成。

---

## 核心功能清单

- **三种分析模式与交互闭环**：
  - **直出分析（`direct`）**：适合明确的数据查询与敏捷洞察，直接取数并产出分析结论与动态图表；
  - **立项规划（`plan`）**：输出包含目标拆解、方法论选择与数据源判定的 `PlanReviewCard` 交互卡，等待用户确认；
  - **方案执行（`execute`）**：精准提取用户确认的规划方案，注入深度方法卡详情，启动全量执行。
- **意图模糊检测与引导反问**：
  - 对过于模糊、短促的输入（如单实体名词）不强出全量复盘报告，主动返回澄清选项与分析方向引导。
- **动态数据源工具集成与跨源联合**：
  - 为启用的数据源动态追加带有 `<sourceId>_` 前缀的查询工具；
  - 动态读取 `config/cross-source-map.json`，在双侧源激活时注册 `cross_source_link` 联合分析能力。
- **服务端看板语法静态验证（`OpenUIDslValidator`）**：
  - 基于 `@openuidev/lang-core` 语法解析器，静态验证模型生成的 OpenUI 看板代码块合法性。
- **断线重连与流状态续接**：
  - 通过 `reconnect=true` 请求参数与探针接口，无缝接管在途执行的服务端后台任务，切页不丢进度。

---

## 业务逻辑与流转机制

### 1. 分析请求流转时序
1. **指令与连接预检**：检查是否为中止操作（`action=stop`）或断线续接操作（`reconnect=true`）；
2. **凭证守卫**：若客户端提供自定义 `baseURL`，必须配对提供 `apiKey`，防止服务端环境变量密钥被非授权转发；
3. **数据源激活与工具注入**：比对当前会话选中的数据源，装配前缀工具并包装 `@openui-analytics/harness-core` 的遥测切面（`composeToolInterceptors`）；
4. **Prompt 拼装与预算控制**：
   - 提取各数据源 Schema Card 摘要，设定 8KB 总预算并根据提问相关度动态展开；
   - 注入当前分析模式变体、方法论指引、认证口径与跨源配对规则；
5. **上下文投影与剪枝**：调用底座 `projectMessagesWithPruning`，保留窗口外工具结果安全裁剪为占位符；
6. **启动流式生成并挂载中继**：启动后台 Reader 写入缓冲区，同时向客户端返回流式响应通道。

### 2. 双重终态与服务端不变量守护
- **显式终态声明**：模型在完成分析或遇到阻碍时调用 `finish_task`；
- **交付断言检查**：服务端严格校验产出证据（可视化看板代码块、规划卡代码块或非空实质文本）。若未产出任何实质内容即宣告完成，予以拒绝并要求补充输出；
- **自然停机兜底**：若模型未调工具自然停机，服务端根据 `finishReason` 与内容特征自动收敛为自然完成或截断告警。

---

## 扩展指南

- **新增 OpenUI 可视化组件**：
  在 `serverLibrary.ts` 中声明新的 Zod Schema，在 `docGenerator.ts` 与 Prompt 资产中补充对应 Few-Shot 示例（由 `docGenerator.test.ts` 严格守护）。
- **新增分析提示词变体**：
  在 `prompt.ts` 中扩展新的系统提示词函数，并在 `handler.ts` 的模式分派中注册处理分支。
- **调整跨源关联拓扑**：
  在应用层配置文件 `config/cross-source-map.json` 中配置映射对，无需修改本包任何源码即可自动联动开启跨源联合分析。
