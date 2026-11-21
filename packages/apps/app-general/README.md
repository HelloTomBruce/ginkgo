# @openui-apps/general · 通用智能助手

OpenUI 平台的**轻应用**范例：知识问答、方案撰写、代码审查与工作区文件协同。
完整接入规范见 [docs/app-integration-guide.md](../../../docs/app-integration-guide.md)。

## 包结构

- `src/manifest.ts` — manifest + 客户端插槽（ArtifactViewer 工作台产物查看器，
  无输入挂件）
- `src/prompt.ts` — 按 mode（direct/plan/build）分支的 System Prompt（静态导出）
- `src/server/tools.ts` — 工作区五工具：read_file / write_file / edit_file /
  run_command / list_dir（全部经 `resolveSafeWorkspacePath` 收敛在会话沙箱内；
  高危命令黑名单 + 30s 超时 + 1MB 输出上限）
- `src/client/ArtifactViewer.tsx` — 产物文件树查看器（经 `/api/workspace` 读取）

## 接入形态

静态包即全量（无运行时单例依赖）：`server.buildSystemPrompt` 直接提供，
工具经宿主路由 `getGeneralTools`（`@openui-apps/general/server` 子路径）接入。
作为对照，深度应用（analytics）需要工厂装配——两种形态的选择标准见接入规范 §2。
