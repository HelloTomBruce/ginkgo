# @ginkgolab/app-sdk

**L0 协议层**：Ginkgo 平台的应用契约唯一事实来源。定义应用包的完整形态（manifest、客户端插槽、服务端接缝、产物协议、消息区扩展），宿主与应用双向只依赖本包类型，互不感知。

## 快速使用

```ts
import { defineApp } from "@ginkgolab/app-sdk";

export const myAppPackage = defineApp({
  manifest: {
    id: "my-app",          // 小写字母数字与 - _（1~64 位）
    name: "我的应用",
    description: "一句话定位",
    icon: "Sparkles",
  },
  client: {
    welcomeMessage: "你好！我是……（必填，defineApp 强制校验）",
    presetQueries: [{ text: "推荐问题", category: "分类" }],
    // —— 以下全部可选，按需声明 ——
    WorkspaceComponent: MyWorkspace,        // 右侧工作台插槽
    workspaceView: "files",                 // canvas | files（工作台视图语义）
    workspaceMount: true,                   // 支持挂载本地文件夹
    InputAccessoryComponent: MyPicker,      // 输入栏挂件插槽
    sidebarTabs: [{ key: "presets", label: "推荐" }],
    sidebarQuickActions: [{ key: "help", label: "帮助", Component: HelpModal }],
    settingsSections: [{ key: "mapping", label: "跨源映射", Component: MappingSettings }],
    dashboardToolbar: { title: "动态看板", pin: true, favorite: true, exportPdf: true },
    messageExtensions: {
      planConfirm: { patterns: ["请确认以下方案"], label: "开始执行", actionPrompt: "……" },
      completion: { title: "任务已完成", buttonLabel: "生成报告", actionPrompt: "……" },
      toolSettledHint: "工具执行完成，正在组织回复...",
    },
    resolvePresetQueries: async () => runtimePresets,
  },
  server: {
    buildSystemPrompt: (ctx) => "...",
    getTools: (ctx) => createSandboxTools({ sandboxDir: ctx.workspace!.sandboxDir }),
    needsWorkspace: true,           // 宿主注入 ctx.workspace
    requiredCapabilities: ["workspace_sandbox"],
    listArtifacts: (ctx) => [...],
    refreshArtifact: async ({ artifactId }) => ({ ok: true, payload: "..." }),
  },
});
```

## 契约面全景

### 客户端插槽（`AppClientContract`）

| 字段 | 说明 |
| --- | --- |
| `welcomeMessage`（必填） | 应用自治欢迎语（宿主兜底文案领域中立，仅防 registry 异常形态） |
| `presetQueries` / `resolvePresetQueries` | 静态推荐 / 运行时解析插槽（异步 resolver，宿主 effect 按应用条件调用） |
| `WorkspaceComponent` | 右侧工作台插槽（`AppWorkspaceProps`：data/onClose/onAction/isExpanded/onToggleExpand） |
| `workspaceView` | `"canvas"`（canvas-only 需先钉选看板）/ `"files"`（缺省） |
| `workspaceMount` | 侧栏「选择文件夹」挂载按钮开关 |
| `InputAccessoryComponent` | 输入栏挂件插槽 |
| `sidebarTabs` | 扩展 Tab（`Component` 自治渲染，或按 key 借宿主内置面板 dashboards/presets） |
| `sidebarQuickActions` | 快捷操作：`onClick` 自治 / `Component` 弹层插槽（宿主统一管理 open） |
| `settingsSections` | 设置中心应用分区（`AppSettingsSectionProps`：appId + 宿主签发的带鉴权 request），即时保存语义；平台级配置归宿主，不在此声明 |
| `dashboardToolbar` | 消息内看板工具条能力（title/pin/favorite/exportPdf，未声明不渲染操作按钮） |
| `messageExtensions` | 消息区扩展：`planConfirm`（patterns 子串匹配确认按钮）/ `completion`（finish_task 总结卡）/ `toolSettledHint`（工具完成过渡文案） |
| `hasWorkspace` / `hasInputAccessory` / `workspaceTitle` | 标志位与文案 |

### 服务端接缝（`AppServerContract`）

| 字段 | 说明 |
| --- | --- |
| `buildSystemPrompt(ctx)` | 应用自治 system prompt（ctx.mode 三模式分发） |
| `getTools(ctx)` | 应用自治工具装配（建议消费 `@ginkgolab/sandbox` 等能力包） |
| `needsWorkspace` | 声明需要会话沙箱 → 宿主解析并注入 `ctx.workspace` |
| `requiresDataTools` / `requiredCapabilities` | 数据工具挂载 / 平台能力依赖声明 |
| `listArtifacts` / `refreshArtifact` | 产物协议（平台产物面板与零 LLM 刷新） |

### 运行时上下文（`AppServerContext`）

`appId` / `sessionId` / `workspace`（`AppWorkspaceContext`：sandboxDir + customRootDir）/ `mode`（direct|plan|execute）/ `messages` / `userQuery` / `enabledSources` / `activeSources` / `sessions`（`AppSessionContextChannel`：上下文元数据读写通道）/ `schemaDigestText` / `methodologyText` 等。

### 其他协议类型

- `AppCanvasData`：画布钉选载荷（宿主 → 工作台插槽）
- `AppSessionContextMeta`：会话上下文元数据（lastPromptTokens 锚点 / summary 缓存 / pendingPlan 等）
- `AppDeliverableContract`：finish_task 终态交付物契约（编排层消费）
- `AppPresetQuery` / `AppMessageExtensions` / `AppSidebarTabSpec` / `AppSidebarQuickActionSpec`

## 设计约束（底座原则 #1 契约先行）

- 新交互扩展**先加本包契约字段，再让宿主按声明渲染**——宿主区分应用的判断只能消费声明数据（布尔/枚举/子串 pattern），禁止 appId 比较、话术正则、硬编码文案；
- 本包只含类型与 `defineApp` 校验，零运行时依赖（不 import ai/harness-core/宿主）；
- 应用包经 `defineApp` 声明（id 形态与 welcomeMessage 必填在此强制）。

接入全景见 [docs/app-integration-guide.md](../../docs/app-integration-guide.md)。


## 权限声明与工具门禁（权限模型 v1）

应用申请能力、宿主执行门禁，**default deny**：`manifest.permissions` 声明申请，
`server.toolPermissions` 声明「工具名 → 所需权限」。宿主只做集合判定，不猜工具语义。

```ts
export default defineApp({
  manifest: {
    id: "my-app",
    name: "我的应用",
    description: "…",
    icon: "Bot",
    // 申请（安装时向用户展示并二次确认）
    permissions: ["datasources.read", "workspace.write"],
  },
  server: {
    // 工具 → 所需权限；未在此声明的工具**不会被挂载**
    toolPermissions: {
      my_query: "datasources.read",
      my_write: "workspace.write",
    },
    getTools: () => ({ my_query, my_write }),
  },
});
```

| 情况 | 宿主行为 |
| --- | --- |
| 未声明 `permissions`（平台内置应用） | 不过滤 |
| 声明了 `permissions` | 只放行「已声明 toolPermissions 且权限已授予」的工具 |
| 工具未写入 `toolPermissions` | 丢弃（default deny） |

可用的权限值见 `APP_PERMISSION_LABELS`；`filterToolsByPermission()` 与
`diffUnacknowledgedPermissions()` 是本模型的公开纯函数。

## 健康检查（`server.healthCheck`）

外部 CLI/服务类依赖由**应用自己探测**，宿主只调用与展示——平台层不持有「能力 → 命令」映射。

```ts
server: {
  healthCheck: async () => ({
    healthy: false,
    status: "missing_deps",                 // ready | degraded | missing_deps
    missingCapabilities: ["cli:my-cli"],
    remediationGuide: "npm install -g my-cli",
    message: "缺少 my-cli，导出功能不可用",
  }),
}
```

放在 `server` 而非 `manifest`：manifest 会被客户端组件链引用，而探测通常依赖
`node:child_process`。第三方应用若写在 `manifest.lifecycle.onHealthCheck`，
注册时会被适配到 `server.healthCheck`（运行时只有一条调用路径）。
宿主侧结果缓存 30s。


## License

MIT © 2026 Ginkgo contributors — 完整条款见包内 `LICENSE`（或仓库根 `LICENSE`）。
