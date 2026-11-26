# @ginkgo/sandbox

沙箱工作区能力包：为应用提供会话沙箱内的原子文件/shell 工具集。参照现代编码代理的内核哲学——**模型在后训练阶段已深刻理解编码代理角色，内核只保留最稳定的原语**，文件检索、Git、测试、日志全靠 bash 组合 Unix CLI 完成，不为每类操作造专用工具。

## 快速使用

```ts
import { createSandboxTools, sandboxToolsPromptSection } from "@ginkgo/sandbox";

// 应用在自己的 getTools 接缝内实例化（sandboxDir 由宿主经 ctx.workspace 注入）
const tools = createSandboxTools({
  sandboxDir: ctx.workspace?.sandboxDir ?? fallbackDir,
  preset: "atomic",              // 可选：atomic（默认）| explorer
  permission: "full",            // 可选：full（默认）| readonly
  env: { GITHUB_TOKEN: "..." },  // 可选：run_command 白名单之外的显式放行
});
```

## 两个正交维度

### preset —— 工具丰富度

| 预设 | 工具集 |
| --- | --- |
| `"atomic"`（默认） | `read_file` / `write_file` / `edit_file` / `run_command` 四把原子工具 |
| `"explorer"` | atomic + `list_dir`（只读目录树浏览，自动过滤 node_modules 等） |

### permission —— 能力边界

| 档位 | 行为 |
| --- | --- |
| `"full"`（默认） | 全量工具 |
| `"readonly"` | **只装配**只读工具（`read_file`，explorer 时含 `list_dir`）；写文件与 shell 不出现——工具集即能力边界，模型幻调未装配工具会收到「工具不存在 + 可用工具列表」反馈（编排层 repair 链路）并自我调整 |

「会话阶段 → 权限档位」的映射属**应用策略**（如 plan → readonly），本包不消费 mode、不感知应用语义。

## 工具说明 prompt 片段

```ts
import { sandboxToolsPromptSection } from "@ginkgo/sandbox";

// 与 createSandboxTools 的 preset/permission 同源拼接进应用 system prompt
const section = sandboxToolsPromptSection("atomic", "readonly");
```

刻意精简（反保姆式说教）：工具参数 schema 对模型完整可见（经 harness-core 的 `zodTool` 包装），组合用法模型已充分掌握；readonly 档位会说明只读边界与「确认后解锁」路径。

## 安全边界

- **路径守卫**：`assertSafePath(workspaceDir, relativePath)` 严防目录穿越，全部文件工具首行校验（唯一实现，宿主 `resolveSafeWorkspacePath` 亦委托于此）
- **命令黑名单**：`rm -rf /`、mkfs、shutdown、fork bomb 等高危指令拦截
- **env 白名单**：子进程环境只透传安全键（PATH/HOME/SHELL/代理/TZ 等），**敏感变量（API Key 等）不进入模型可诱导的 shell**；额外变量经 `env` 注入位显式放行
- **超时与输出上限**：默认 30s 超时 + 1MB 输出上限，`timeoutMs` 参数可调

## 边界与约定

- 本包不 import 任何应用包与宿主代码；`sandboxDir` 由消费方注入
- 全部工具经 `zodTool` 包装：模型侧收到完整参数 JSON Schema（properties/required），校验失败返回结构化 `{ error, isError }` 反馈给模型自我纠正，不上抛终结会话流
- 错误约定与其他工具面一致：`{ error, isError: true }`（遥测切面按 `isError` 判定 `ok:false`）


## License

MIT © 2026 Ginkgo contributors — 完整条款见包内 `LICENSE`（或仓库根 `LICENSE`）。
