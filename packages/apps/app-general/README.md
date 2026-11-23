# @openui-apps/general · 通用智能助手

Ginkgo 平台的**轻应用**范例：知识问答、方案撰写、代码审查与工作区文件协同。
完整接入规范见 [docs/app-integration-guide.md](../../../docs/app-integration-guide.md)。

## 包结构

- `src/manifest.ts` — manifest + 客户端插槽声明：ArtifactViewer 工作台（`workspaceView: "files"`）/ `workspaceMount: true`（本地文件夹挂载）/ 推荐 presetQueries（无输入挂件）
- `src/index.ts` — 静态包定义：`server.buildSystemPrompt` + `server.needsWorkspace: true`（宿主注入 `ctx.workspace`）
- `src/prompt.ts` — 按 mode（direct/plan/build）分支的 System Prompt；工具说明段由 `sandboxToolsPromptSection("atomic", mode === "plan" ? "readonly" : "full")` 与工具装配同源拼接
- `src/server/index.ts` — **沙箱工具装配**（运行时实现，仅服务端经 `./server` 子入口消费——宿主组合根 runtimeServers 注入；不进主入口，否则 Node 内置模块泄漏进客户端 bundle）：消费 `@openui-analytics/sandbox` 能力包 `createSandboxTools({ sandboxDir, preset: "atomic", permission: ctx.mode === "plan" ? "readonly" : "full" })`
- `src/client/ArtifactViewer.tsx` — 产物文件树查看器（经 `/api/workspace` 读取）

## 接入形态（轻应用 vs 深度应用）

静态包即全量（无运行时单例依赖）：工具装配在 `./server` 子入口（`getGeneralTools`），
由宿主组合根 `runtimeServers.ts` 注入 `server.getTools`——**plan 模式权限收敛为
readonly**（只装配只读工具，写入与命令执行在方案确认进入 execute 后解锁），模式→
权限的映射属应用策略，能力包不感知。

作为对照，深度应用（analytics）需要工厂装配 + 领域 lib 自持——两种形态的选择标准
见接入规范 §2。

## 与 openui-sandbox 的关系

本包**不自持任何工具实现**：四原子工具（read_file/write_file/edit_file/run_command）、
readonly 权限档、env 白名单、prompt 片段全部来自 `@openui-analytics/sandbox`
能力包。需要工具丰富度变化（如只读探索 list_dir）时改声明
`preset: "explorer"` 即可，零工具代码。
