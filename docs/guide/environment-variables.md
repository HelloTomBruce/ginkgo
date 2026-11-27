# 环境变量

所有变量均可选——页面「设置」中的配置优先级更高（存浏览器 localStorage）。

## LLM 接入

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `OPENAI_API_KEY` / `LLM_API_KEY` | LLM API Key | 无 |
| `OPENAI_BASE_URL` / `LLM_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` / `LLM_MODEL` | 模型名 | `gpt-4o-mini` |

## 任务熔断与预算

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LLM_TASK_TIMEOUT_MS` | 单任务 wall-clock 上限（超时自动中止） | 600000（钳 30s–60min） |
| `LLM_TASK_TOKEN_BUDGET` | 单任务累计 token 预算（超限写 `budget_exhausted` 终态并中止） | **不限制**（显式给 >0 值启用，钳 10k–5M；≤0 视为不限制） |
| `LLM_MAX_CONCURRENT_TASKS` | 进程级同时 running 任务数上限（超限返回 429） | 8（钳 1–64） |
| `LLM_TOOL_OUTPUT_MAX_BYTES` | 单个工具结果进入模型上下文的字节上限（头尾保留截断） | 32768（钳 4KB–1MB） |
| `LLM_MAX_OUTPUT_TOKENS` | 每步输出 token 上限 | 16384（钳 1024–65536） |
| `LLM_MAX_STEPS` | 全局步数熔断上限 | execute 50 / plan 25（钳 1–150） |
| `LLM_BUILD_MAX_STEPS` | execute/build 模式独立步数预算 | 50 |
| `LLM_PLAN_MAX_STEPS` | plan 模式独立步数预算 | 25 |

| `LLM_TENANT_TOKEN_LIMIT` | 租户 token 配额（跨任务累计；未设置则零拦截） | 无 |
| `LLM_EXECUTE_MAX_STEPS` | execute 模式的旧名称，等价 `LLM_BUILD_MAX_STEPS`（保留兼容） | 50 |

::: tip 部署建议
本地单人使用缺省不限制 token 预算即可；**多人或公网部署时建议显式设置 `LLM_TASK_TOKEN_BUDGET`**（如 `600000`），与 `LLM_TASK_TIMEOUT_MS`、`LLM_MAX_CONCURRENT_TASKS` 构成成本护栏三道闸。
:::

## 任务存储与多副本

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LLM_TASK_STORE` | 任务存储后端：`memory` / `file` / `redis` | `memory` |
| `LLM_TASK_STORE_DIR` | `file` 后端的落盘目录（**相对 cwd**，建议显式给绝对路径） | `data/stream-tasks` |
| `REDIS_URL` | `LLM_TASK_STORE=redis` 必填（如 `redis://localhost:6379`） | 无 |
| `LLM_INSTANCE_ID` | 实例标识（遥测/多副本区分来源） | `hostname:pid` |
| `HARNESS_*` | 能力包的分层配置面（流式、熔断、MCP、遥测、图编排等约 40 个变量，另有 `LLM_*` 兼容别名）；完整清单见 `packages/ginkgo-harness-core/src/config/envLoader.ts` | — |

> 多副本部署请阅读 [LLM Harness 多副本部署指南](../llm-harness-multi-instance)，其中的「必须」项不可省略。

## 模型韧性与回退

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LLM_MAX_RETRIES` | 单次模型调用最大重试次数（指数退避） | 见 `resilience.ts` 缺省 |
| `LLM_REQUEST_TIMEOUT_MS` | 单次模型请求超时（毫秒） | 见 `resilience.ts` 缺省 |
| `LLM_FALLBACK_MODELS` | 回退模型链，JSON 数组（如 `["gpt-4o-mini","claude-3-5-haiku"]`）；请求体同名字段优先 | 无 |
| `LLM_TOKENIZER` | 设为 `tiktoken` 时按 `model-tokenizer.json` 映射加载真实 tokenizer（否则启发式估算） | 关闭 |

> `LLM_FALLBACK_MODELS` / `LLM_MAX_RETRIES` / `LLM_REQUEST_TIMEOUT_MS` 的**请求体优先级高于环境变量**（单次请求可覆盖）。

## 应用专属变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `CLAUDE_DESIGN_PORT` | 体验设计工坊（design）启动 `claude-design` 画板服务的端口 | 由 CLI 决定 |
| `CLAUDE_DS_PORT` | design 启动 `claude-design-system` 服务的端口 | 由 CLI 决定 |

> 这两项属于 **design 应用**的领域配置，平台层不感知；其他应用请在自己的 `server.healthCheck` / 配置中自持同类变量。
>
> 仅评测内部使用：`LLM_TIER_B_BUDGET`（Tier B 评测预算）、`OPENAI_API_AUTH_TOKEN`（测试桩），正常部署无需设置。

## 数据源

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PGUSER` / `PGHOST` / `PGDATABASE` / `PGPASSWORD` / `PGPORT` | 分析库连接（缺表自动建表写示例数据） | 本机 `ginkgo_analytics` 库 |
| 动态 DB 源 | `dbType` 四选：postgres / mysql / sqlite / clickhouse，页面「设置 → 数据源」配置，全部只读双保险 | — |
| GitLab MCP Endpoint / Token | 页面「设置」中配置，存于浏览器 localStorage | `http://127.0.0.1:5002/mcp` |

禅道数据源依赖本机已登录的 `zentao` CLI（`zentao mcp --read-only`），无需额外配置。

## 部署鉴权

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `GINKGO_API_AUTH_TOKEN` | 部署模式 API 鉴权令牌；配置后所有 `/api/*` 须携带 `Authorization: Bearer <token>` | 无 |

## 存储根

平台的数据（会话、看板、上传文件、工作区沙箱）与配置（数据源、MCP、应用清单等）统一落在一个**存储根**下，按 `config/`、`data/`、`plugins/`、`logs/` 分类。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `GINKGO_HOME` | 存储根绝对路径（**显式指定才搬家**） | 见下方解析顺序 |
| `GINKGO_DATA_DIR` | 旧变量名，等价于 `GINKGO_HOME`（同时设置时 `GINKGO_HOME` 优先） | 无 |

解析顺序（**默认零变更**是首要约束）：

1. `GINKGO_HOME` / `GINKGO_DATA_DIR` 显式配置 → 使用该路径；
2. 仓库/工作目录下已存在 `./data` 或 `./config` → **沿用当前目录**（既有安装升级后不会搬家，与 `NODE_ENV` 无关）；
3. 全新安装（两者都不存在）→ `~/.ginkgo`（Windows 回退 `%USERPROFILE%\.ginkgo`）。

::: warning 迁移既有数据
平台**不会自动迁移**。设置 `GINKGO_HOME` 后若本地仍有 `./data`/`./config`，启动日志会告警，并提供迁移助手：

```bash
GINKGO_HOME=~/.ginkgo pnpm storage:migrate --dry-run   # 先看会做什么
GINKGO_HOME=~/.ginkgo pnpm storage:migrate             # 复制并校验
```

它只**复制**、不覆盖、不删除源目录；确认数据完整后由人手动删除旧目录。
:::

`GINKGO_RESOLVED_HOME` 由平台在启动期自动注入（能力包与应用包据此对齐同一存储根），一般**不需要手动设置**。

## 应用安装（高危能力）

应用安装会执行 `npm install` 并 `import()` 第三方代码——等同于在主机上执行任意代码，因此**默认关闭**。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `GINKGO_ALLOW_APP_INSTALL` | 设为 `1` 才开启 `POST /api/apps/install`；未开启时该接口返回 403 | 关闭 |
| `GINKGO_APP_INSTALL_TOKEN` | 安装接口的独立令牌，请求须带 `x-ginkgo-install-token` 头 | 无 |
| `GINKGO_ALLOW_LOCAL_APP_PACKAGE` | 设为 `1` 才允许从本地 tarball（`file:` / 绝对路径 `.tgz`）安装 | 关闭 |

::: warning 共享/公网环境必读
`GINKGO_API_AUTH_TOKEN` **默认不配置**（本地单机形态全部放行），而安装接口的爆炸半径远高于其它写接口。部署到共享环境时请务必同时设置 `GINKGO_ALLOW_APP_INSTALL=1` + `GINKGO_APP_INSTALL_TOKEN`。
:::

即便开启安装，仍有三道内建约束：包名必须是 `@scope/name[@semver]` 形态（拒绝路径穿越与裸包名）；内置应用 id 不可被动态包覆盖；声明了 `permissions` 的包必须在 UI 中确认权限后才会启用（未映射的工具一律不挂载）。
