# @openui-analytics/datasources

OpenUI 的数据源配置/连接/工具装配层：把任意 MCP 远端、数据库、本地 CLI、CSV/Excel 文件统一装配为带 `<源id>_` 前缀的 MCP 工具集，并在 SQL 执行路径上叠加只读守卫管线、结果集缓存、EXPLAIN 成本熔断、Schema Card 结构卡与 Certified Queries 语义层。

## 包定位与依赖

| 维度 | 说明 |
|---|---|
| 定位 | 数据源配置读写、四类 kind 连接装配（键控缓存）、工具绑定、守卫网关；由 app 侧 `src/lib/datasources.ts` 以 `config/datasources.json` 为配置路径创建 globalThis 单例，`@openui-analytics/llm`（workspace 依赖）注入使用并装配 LLM 工具 |
| 工作区依赖 | 无（不依赖其他 workspace 包，纯自包含） |
| 外部依赖 | `@modelcontextprotocol/sdk`（MCP Client/Server、InMemory/StreamableHTTP/SSE/stdio 传输）、`pg`、`mysql2`（惰性加载，缺失时给出降级提示）、`@clickhouse/client`、`@duckdb/node-api`（file 源进程内引擎）、`exceljs`（xlsx 解析）；SQLite 走 Node 内置 `node:sqlite`（≥22.13），零第三方驱动 |
| peerDependencies | `ai`（optional）：仅子路径 `adapters/ai` 使用，主入口 client-safe（前端仅 import type） |
| 落盘 | `config/datasources.json`（源配置 v3）、`data/files/<sourceId>/`（原始文件 + `analytics.duckdb` + `manifest.json`）、`data/schema-cards/<sourceId>.json`（结构卡） |

## 目录结构

| 目录/文件 | 职责 |
|---|---|
| `src/index.ts` | 统一入口（client-safe）：config/manager + gateway/certified 全量 re-export |
| `src/manager.ts` | 门面 `createDatasourceManager`：配置读写（委托 config 纯函数）、四类 kind 连接装配与键控缓存、`tools()` 工具绑定、`mergeToolSets`；`describeDynamicSource` 产出脱敏描述符 |
| `src/config.ts` | 配置模型 v3 纯函数层：`loadConfigFile`/`writeConfigFile`（tmp+rename 原子写）、`validateSourceConfig`、`upsertSource`/`deleteSource`、脱敏 `maskUrl`/`maskHeaders`/`maskParams`/`maskConnectionString` |
| `src/connectors/http.ts` | `connectHttpMcp`：Streamable HTTP 优先，失败降级 SSE |
| `src/connectors/stdio.ts` | `connectStdioMcp`（按 command+args 拉起子进程）、`probeStdioCli`（真实握手探活） |
| `src/connectors/db/sqlGuard.ts` | SQL 词法守卫：`assertReadOnlySql`（仅 SELECT/WITH、禁多语句与 DDL/DML/高危函数）、`enforceRowLimit`（剥离字面量/注释后补 `LIMIT 200`）、`guardReadOnlySql`；`DbDialectClient` 客户端契约 |
| `src/connectors/db/dialect.ts` | `DbDialect` 接口 + `DIALECTS` 用户配置注册表（postgres/mysql/sqlite/clickhouse；duckdb 仅供 file 连接器内部） |
| `src/connectors/db/*Dialect.ts` | 5 个方言：pg（专用连接 + `BEGIN READ ONLY` + `statement_timeout 5s`）、mysql（`START TRANSACTION READ ONLY` + `max_execution_time`）、sqlite（`readOnly:true` 打开）、clickhouse（请求级 `readonly=1`）、duckdb（`access_mode=READ_ONLY` + `SET disabled_filesystems` 禁读本地文件系统） |
| `src/connectors/db/dbMcpServer.ts` | `createDbMcpServer`：进程内 MCP Server，暴露 `execute_sql`/`list_tables`/`describe_table`；错误一律以 `isError` 内容返回，绝不抛出 |
| `src/connectors/file/fileStore.ts` | CSV/XLSX/Parquet/JSON/NDJSON → DuckDB 完全覆盖式灌库（staging 构建 + 整体替换）+ manifest 读写；`isSupportedUpload`/`sanitizeTableName` |
| `src/gateway/mcpGateway.ts` | `McpGateway`：统一查询代理（流经共享守卫管线）+ 两阶段 Schema 发现（`listCatalogs`/`describeTableResource`） |
| `src/gateway/queryPipeline.ts` | `executeSqlWithGuards`：守卫管线唯一事实源（manager 工具绑定与 gateway 共用） |
| `src/gateway/queryCache.ts` | `QueryCacheManager`（TTL + LRU）：`normalizeSqlForCache`（字面量/引用标识符原文保留）+ `computeQueryHashKey`（sha256 全量哈希，不截断） |
| `src/gateway/explainGuard.ts` | `dryRunExplain`：按方言拼 EXPLAIN、递归解析执行计划识别全表扫描与扫描行数；`SQL_FAULT_RE` 拦截非法 SQL，基础设施异常降级放行 |
| `src/gateway/types.ts` | `ExplainOptions`/`ExplainCostReport`/`QueryResultWithMeta`/`ExecuteQueryArgs` 等网关契约 |
| `src/schema/card.ts` | 结构卡纯函数（`buildSchemaCard`/`buildMcpToolCard`/`renderCardForPrompt`/`scoreTableRelevance`）与采集器（`collectSchemaCard`/`collectTableProfile`，经 `SchemaProbe` 抽象，测试可注入假探针） |
| `src/schema/store.ts` | 结构卡落盘：`readSchemaCard`（坏卡返回 null 触发重建）/`writeSchemaCard`（64KB 上限防线）/`deleteSchemaCard` |
| `src/schema/cardLifecycle.ts` | `createSchemaCardLifecycle` 状态机：`ensure`（惰性建）/`invalidate`（标脏重建）/`markDirty`+`pumpIfDirty`/`refresh`/`drop`，含失败熔断与按源串行链 |
| `src/certified/certifiedStore.ts` | `CertifiedQueryStore`：认证查询知识库（文件持久化 + mtime 热加载 `reloadIfChanged` + 内存索引） |
| `src/certified/semanticRouter.ts` | `tokenizeText`（中英词元）+ `matchCertifiedQueries`（加权召回与置信度分档） |
| `src/certified/types.ts` | `CertifiedQuery`/`CertifiedQueryParam`/`CertifiedQueryMatch` 类型 |
| `src/parseToolResult.ts` | `parseMcpToolResult`：MCP 结果统一解析（isError 透传、text 拼接、JSON 尝试解析），manager 与 ai 适配器共用 |
| `src/adapters/ai.ts` | `toAiTools`：把 `McpToolBinding` 包装为 Vercel AI SDK `CoreTool`（execute 出错返回 `{error, isError:true}` 而非抛出） |

## 架构

```
manager 门面 createDatasourceManager（配置缓存 + 连接缓存，全实例私有状态）
  ├─ connector 传输层：http-mcp（connectHttpMcp）｜stdio-cli（connectStdioMcp）
  │                    db（DIALECTS 方言 + createDbMcpServer 进程内 MCP，经 InMemoryTransport 自连）
  │                    file（fileStore 灌库 + duckdbDialect 直连 analytics.duckdb）
  ├─ MCP 工具装配：tools() 把 listTools 结果包成 McpToolBinding（注册名 <id>_原名，call 走 originalName）
  ├─ gateway 守卫管线 executeSqlWithGuards：词法 sqlGuard + 方言引擎级只读双保险
  │                            → queryCache 结果集缓存 → dryRunExplain 成本门禁 → 执行 → 回写缓存
  ├─ schema 结构卡：cardLifecycle 状态机（惰性生成/标脏重建/失败熔断），llm 包经 renderCardForPrompt 注入 prompt
  └─ certified 语义层：CertifiedQueryStore 知识库 + matchCertifiedQueries 语义路由，llm 包按置信度注入
```

- **工具如何暴露给 LLM**：`adapters/ai.ts` 的 `toAiTools(bindings)` 把绑定转成 ai-sdk tool（工具定义以 MCP Server 为唯一事实来源），llm 包 `handler.ts` 再用 `mergeToolSets` 合并多源工具集（同名冲突跳过并告警）。
- **配置来源**：用户在「设置 → 数据源」页或 `config/datasources.json` 配置，代码零硬编码数据源（项目铁律）——`config.ts` 只定义 schema 与校验/脱敏，不含任何源 id/名称。
- **双保险只读**：词法黑名单只是体验层（给出明确「安全限制」报错）；硬约束在各方言引擎级（pg 只读事务、sqlite readOnly 打开模式、clickhouse readonly=1、duckdb READ_ONLY）。

## 业务逻辑

- **数据源激活与工具装配**：`resolveActive(ids)` 过滤 enabled 源 → llm 包对每个激活源调 `manager.tools(source)` → `getOrConnectEntry`（`configKey`=完整配置 JSON，配置变更即关闭旧连接并 `markDirty` 结构卡）→ `withSessionRetry` 对 http 源的「Session not found」类错误自愈（驱逐→重连→重试一次）→ `cardLifecycle.ensure` 惰性建卡。
- **一次查询的守卫管线**（`executeSqlWithGuards`，工具绑定对 `execute_sql`/`read_query` 透明接入）：① `assertReadOnlySql` 词法只读断言 → ② `computeQueryHashKey` 缓存探查（`skipCache` 跳过）→ ③ `dryRunExplain` 成本门禁（有 `dialectClient` 且非 `bypassExplain`；`SQL_FAULT_RE` 命中即拦截回传自愈提示，`exceedsBudget` 触发熔断，EXPLAIN 不支持/基础设施异常降级放行）→ ④ `execute()` 真实执行（db 源再过方言 `readOnlyQuery`）→ ⑤ `cache.set` 回写。执行报错命中 `SCHEMA_MISS_RE`（列/表缺失类文案）→ `cardLifecycle.invalidate` 标脏后台重建。
- **缓存命中逻辑**：`normalizeSqlForCache` 折叠结构部分的空白与大小写，但字符串字面量与双引号标识符原文保留参与哈希（防 `'ABC'`/`'abc'` 错配）→ 键 `sourceId:sqlHash:paramsHash` 全量 sha256；默认 TTL 15 分钟、LRU 500 条；`delete`/`close`/`ingestFiles`/`removeFiles` 联动 `queryCache.invalidate(sourceId)`；manager 与 `McpGateway` 共享同一实例保证失效一致。
- **Certified Queries 语义路由**：`store.reloadIfChanged()` 按配置文件 mtime 热加载（改 `config/certified-queries.json` 免重启）→ `matchCertifiedQueries(userQuery, activeSourceIds, store, limit=3)`：标签命中 +3.0 / 标题 +2.5 / 描述与公式 +1.0 加权，归一化得分分档 ≥0.85 `exact`（强约束绑定）、0.6–0.85 `high`（Few-Shot 参考）、≥0.35 `medium`、其余 `low` 仅记录不注入。
- **文件数据源灌库**：`ingestFiles` → `queryCache.invalidate` → 按源串行链（`ingestChains` 防并发上传竞态）→ 关闭持有旧库句柄的缓存连接 → `ingestSourceFiles` 在 staging 目录构建（文件名清洗落盘 `raw/`；xlsx 经 `excelToCsvSpecs` 每 sheet 转临时 CSV，首行为表头；parquet/json 走 DuckDB 原生 `read_parquet`/`read_json_auto`；CSV 走 `read_csv_auto`；表名 `sanitizeTableName` 清洗去重、路径经绑定参数防注入）→ 写 `manifest.json` → 整体 rename 替换（失败旧数据原样保留）→ `cardLifecycle.invalidate`。

## 功能清单

| 门面 API（`createDatasourceManager` 返回） | 用途 |
|---|---|
| `readConfig`/`writeConfig`/`validate`/`upsert`/`delete`/`get`/`list` | 配置 CRUD（`list` 经 `describeDynamicSource` 脱敏：凭证只暴露存在性/掩码形态） |
| `connect`/`tools`/`close`/`health` | 连接装配（键控缓存）、工具绑定（`<id>_` 前缀）、关闭（联动清缓存）、探活（3s 超时） |
| `resolveActive(ids)` | 激活源摘要（`undefined` = 全部 enabled 源） |
| `ingestFiles`/`filesManifest`/`removeFiles` | 文件源灌库（完全覆盖语义）/manifest 读取/落盘清理 |
| `getSchemaCard`/`refreshSchemaCard` | 结构卡读取（`stale` 标脏标记）/手动重建（按源串行） |
| `getDialectClient`/`getQueryCache`/`gateway` | 供 `McpGateway` 与 EXPLAIN 预检的内部能力出口 |
| `mergeToolSets(target, incoming, sourceId)` | 多源工具集合并（同名冲突跳过并告警） |

| 子路径 exports | 用途 |
|---|---|
| `.` | 主入口（client-safe）：config/manager + gateway/certified 全部导出 |
| `./adapters/ai` | `toAiTools`（ai-sdk CoreTool 适配，optional peer `ai`） |
| `./schema/card` | `SchemaCard` 类型 + 渲染/评分纯函数（client-safe） |
| `./schema/store` | 结构卡落盘读写（含 `node:fs`，仅服务端引入） |
| `./sqlGuard` | `assertReadOnlySql`/`enforceRowLimit`/`guardReadOnlySql`（app 侧 `dashboardRefresh` 复用） |
| `./parseToolResult` | `parseMcpToolResult`（specMaterialize/distinctValues 等复用） |
| `./gateway` | `McpGateway` 类 |
| `./certified` | `CertifiedQueryStore` 类 |

## 如何扩展

- **新增一种数据源 kind**：`config.ts` 加 `XxxSourceConfig` 接口并在 `normalizeSourceEntry`/`validateSourceConfig` 加分支 → `manager.ts` 的 `configKey`/连接装配/`describeDynamicSource` 加分支 → `config.test.ts` 补校验用例。
- **新增一种数据库方言**：`connectors/db/` 建文件实现 `DbDialect`（`connect`/`listTables`/`describeTable`/`readOnlyQuery`/`ping`），`readOnlyQuery` 必须先 `guardReadOnlySql` 再叠加引擎级只读保障，然后 `dialect.ts` 的 `DIALECTS` 注册一行（内部专用型如 duckdb 则不注册，仅供特定连接器使用）。
- **新增 Certified Query**：`config/certified-queries.json` 追加 `{ id, sourceId, title, description, sqlTemplate, allowedParams, tags }`（`sourceId` 可为 `"*"` 全源可用；运行时也可 `CertifiedQueryStore.upsert`），语义路由按 `tags`/`title` 词元命中，写清业务口径描述即可被召回。

## 测试

`vitest`（`vitest.config.ts`，node 环境，`src/**/*.test.ts`），`pnpm test` 运行。覆盖：

- **守卫绕过攻击样例**（`dialect.test.ts`）：多语句分号注入、前导空白/注释伪装 DELETE、`SELECT ... INTO` 隐式建表、CTE 内嵌写操作、`pg_sleep`/`pg_terminate_backend` 资源攻击、`FOR UPDATE/SHARE` 行级锁、`set_config` 会话篡改，以及「字面量含 limit」不误伤封顶与标识符片段不误判。
- **方言层**（`dialects.test.ts` 覆盖 pg/mysql/`DIALECTS` 注册表 + `sqlite`/`clickhouse`/`duckdb` 各 test）：pg 只读四步落在同一专用连接、mysql 保留字反引号转义与 `?` 占位符透传、duckdb BigInt 值归一化与「绕过词法层也无法写」引擎级回归、clickhouse URL 解析与连接 fail-fast 等。
- **缓存**（`queryCache.test.ts` + `manager.gateway.test.ts`）：归一化哈希一致性、字面量/标识符大小写不共享键、全量哈希防碰撞、TTL 过期、LRU 淘汰、按源失效、文件源透明接入（空格换行差异仍命中）。
- **成本门禁**（`explainGuard.test.ts`）：pg/mysql 执行计划解析与全表扫描识别、语法错误拦截、params 绑定透传防误判、EXPLAIN 不受支持时优雅降级放行。
- **其余**（`mcpGateway`/`manager*`/`card`/`store`/`certifiedStore`/`semanticRouter`/`ai`/`config`/`fileStore`/`http` 各 test）：网关两阶段发现、Schema Card 生命周期与删除联动、语义路由分档、`toAiTools` 错误兜底、配置 v3 校验与脱敏、灌库与 manifest、HTTP 传输降级。
