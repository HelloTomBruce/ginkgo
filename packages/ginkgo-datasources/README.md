# @ginkgo/datasources

Ginkgo 结构化数据源连接、工具装配、安全查询网关与语义层底座：原生直连标准关系型数据库与本地分析文件（DuckDB），并在执行路径上深度集成词法与方言双重只读守卫、LRU 结果集缓存、EXPLAIN 成本熔断、Schema Card 结构探查及 Certified Queries 业务语义层。

> [!NOTE]
> **关于 MCP 职责边界划分**：
> 外部第三方远程服务（如 Figma, GitHub, Notion 等 Stdio / SSE / HTTP MCP Server）的连接池与工具转换全量由底层框架 `@ginkgo/harness-core` 的 `MCPClientManager` 承接；
> 本包（`@ginkgo/datasources`）**完全去 MCP 化**，不依赖 `@modelcontextprotocol/sdk`，专注于高可靠、高安全的**结构化数据源连接与查询治理（RDBMS & Local Analytics Files）**。

## 包定位

- **原生结构化数据源连接器**：直连关系型与 OLAP 数据库（PostgreSQL、MySQL、SQLite、ClickHouse）以及基于 DuckDB 的本地结构化文件（CSV、Excel、Parquet、JSON），统一封装为带有源 ID 前缀隔离的数据源工具集（`DatasourceToolBinding`）。
- **查询安全网关与成本防线（QueryGateway）**：承担所有数据查询的安全防护职责，杜绝任何非授权数据修改、高危 DDL、多语句注入或超大查询引发的计算资源耗尽。
- **与兄弟包的依赖关系**：
  - 作为独立底层数据包，不依赖其他 workspace 包；
  - 为 `@ginkgo/llm` 提供数据源管理能力、可用工具绑定及上下文所需的 Schema Card 和认证口径；
  - 核心只读校验逻辑与工具结果解析纯函数被应用服务端逻辑广泛复用。

---

## 核心架构

数据源层采用**门面统一收口、原生方言直连、查询安全网关串联、语义增强辅助**的分层设计：

```
+-------------------------------------------------------------------------------+
|                    createDatasourceManager (数据源管理门面)                     |
|  - 配置读写与动态脱敏  - 连接键控缓存与会话自愈  - 工具装配 (带前缀绑定与信封截断)   |
+---------------------------------------+---------------------------------------+
                                        |
        +-------------------------------+-------------------------------+
        |                                                               |
        v                                                               v
+-------------------------------+                               +-------------------------------+
|     原生方言连接器 (Connectors) |                               |     查询安全网关 (QueryGateway) |
| - PostgreSQL (只读事务与超时)  |                               | - 词法静态只读断言 (SqlGuard) |
| - MySQL (方言转义与流式读取)    |                               | - 结果集 SHA-256 全量哈希缓存 |
| - SQLite (物理只读文件模式)    |                               | - EXPLAIN 执行计划成本熔断门禁|
| - ClickHouse (原生客户端驱动)  |                               | - 行数上限强制注入 (LIMIT 200)|
| - DuckDB 文件分析引擎 (CSV/XLSX)|                               | - 两阶段元数据发现 (Catalogs) |
+-------------------------------+                               +---------------+---------------+
                                                                                |
        +-----------------------------------------------------------------------+
        |
        v
+-------------------------------------------------------------------------------+
|                            业务语义与上下文增强层                              |
| - Schema Card: 两阶段字段探查、低基数枚举提取、错误标脏重建状态机              |
| - Certified Queries: 权威业务口径知识库、加权分档语义路由召回 (SemanticRouter) |
+-------------------------------------------------------------------------------+
```

### 1. 统一管理门面与连接生命周期（DatasourceManager）
通过管理器单例提供配置读写、连接生命周期托管及工具绑定的统一出口。连接实例基于配置内容的确定性序列化结果（Config Key）进行键控缓存；当配置更新时，旧连接自动安全回收，防止资源泄露。

### 2. 原生直连方言驱动（DbDialect）
摒弃冗余的中间协议层，通过 `DbDialectClient` 直接驱动目标数据库：
- **PostgreSQL**：施加只读事务与语句超时（statement_timeout）；
- **MySQL**：方言关键字处理与反引号转义；
- **SQLite**：以物理只读标志打开连接文件；
- **ClickHouse**：通过官方客户端进行高并发分析查询；
- **DuckDB 文件引擎**：在临时 Staging 目录全量转制多 Sheet Excel 与 CSV，原子替换保证一致性。

### 3. 多层拦截的安全查询网关（QueryGateway）
所有 SQL 查询均流经统一的查询守卫管线：
1. **词法只读静态检查**：严格断言仅包含 `SELECT` / `WITH`，拦截 `DROP`、`ALTER` 等 DDL 与写操作；
2. **结果集全量 Hash 缓存**：基于标准化 SQL 语法树与参数哈希实现毫秒级命中复用；
3. **EXPLAIN 成本熔断门禁**：对执行计划进行语法树递归分析，预估扫描行数超预算或全表扫描高危时主动熔断；
4. **强制分页封顶**：自动为末尾缺少限制的查询安全注入 `LIMIT 200`。

### 4. 业务语义增强与结构卡（Schema Card & Certified Queries）
- **Schema Card**：自动探查数据源表结构、字段类型与低基数枚举特征，生成供 LLM Prompt 消费的精简结构卡；遇到查询缺失异常时自动标脏触发重建；
- **Certified Queries**：维护经过业务核准的标准指标口径（如 CAC、GMV、净收入）与 SQL 模板，配合语义路由器（SemanticRouter）在用户提问时高置信度召回。

---

## 核心功能清单

- **原生数据库连接器（Connectors）**：
  - `PostgresDialect`、`MysqlDialect`、`SqliteDialect`、`ClickhouseDialect`、`DuckDbDialect`；
  - `createDbToolsConnection`：生成标准数据库工具（`execute_sql`、`list_tables`、`describe_table`）。
- **查询网关与安全守卫（QueryGateway & Guardrails）**：
  - `QueryGateway`（原名 `McpGateway` 保持兼容别名）：SQL 执行路由器与两阶段发现接口；
  - `executeSqlWithGuards`：集只读守卫、缓存管理与 EXPLAIN 成本分析于一体的执行管线；
  - `QueryCacheManager`：基于 LRU 与 TTL 的数据源级别缓存隔离；
  - `evaluateExplainCost`：执行计划全表扫描与行数超限检测。
- **本地文件数据源（FileStore）**：
  - 支持 CSV、Excel、Parquet、JSON 文件的 Staging 目录构建与原子生产替换；
  - 自动表名安全清洗与多 Sheet 拆分。
- **结构卡治理（SchemaCard）**：
  - `buildSchemaCard` / `collectSchemaCard`：两遍探查算法提取表结构与低基数 Top 取值；
  - `renderCardForPrompt`：带字节预算限制的提示词渲染与相关度排序。
- **Certified Queries 语义层（Certified）**：
  - `CertifiedStore`：认证口径存储与检索；
  - `SemanticRouter`：基于分词与中英文加权算法的口径精确命中。
- **AI 适配器（Adapters）**：
  - `toAiTools`：将 `DatasourceToolBinding` 映射为 Vercel AI SDK 的 `CoreTool` 规范，内置超长输出信封化截断（`envelopeOversizeResult`）。

---

## 扩展指南

- **新增数据库方言支持**：
  实现 `DbDialect` 接口（提供只读包装、表结构查询与 EXPLAIN 模板），并在 `DIALECTS` 注册表中注册方言映射。
- **接入自定义认证口径**：
  在应用层通过 `createCertifiedStore` 注册新的认证指标公式与规范 SQL 模板。
- **调整安全扫描预算**：
  在 `createDatasourceManager` 初始化时传入 `explainOptions`，调整单次查询最大扫描行数阈值或全表扫描拦截策略。


## License

MIT © 2026 Ginkgo contributors — 完整条款见包内 `LICENSE`（或仓库根 `LICENSE`）。
