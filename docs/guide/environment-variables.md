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

::: tip 部署建议
本地单人使用缺省不限制 token 预算即可；**多人或公网部署时建议显式设置 `LLM_TASK_TOKEN_BUDGET`**（如 `600000`），与 `LLM_TASK_TIMEOUT_MS`、`LLM_MAX_CONCURRENT_TASKS` 构成成本护栏三道闸。
:::

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
