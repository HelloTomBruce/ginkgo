# 五条底座原则

裁决一切新代码的设计宪法。任何 PR 违反以下任一条，评审应直接打回。

## 1. 契约先行

一切扩展点在 app-sdk 声明——client 声明 UI 能力（`dashboardToolbar` / `workspaceView` / `workspaceMount` / `messageExtensions` / `resolvePresetQueries` / 快捷动作 `Component`），server 声明运行时能力（`buildSystemPrompt` / `getTools` / `needsWorkspace` / `listArtifacts` / `refreshArtifact`）。

新能力先进契约，再进实现；禁止绕过协议层私拉接线。

## 2. 组合根唯一

appId→实现的绑定**只在** `src/lib/apps/registry.ts` / `runtimeServers.ts` / API 薄壳路由。宿主其余代码禁止 appId 比较、缺省值散布——一律 import registry 的 `DEFAULT_APP_ID` / `getOrDefault`。

## 3. 语义声明化

宿主区分应用的判断必须是应用声明的**数据**（布尔/枚举/子串 pattern），禁止话术正则与硬编码文案。

## 4. API 薄壳化

Next.js 文件路由只做「拆包 → 委托应用/能力包 handler → 状态码映射」，业务校验与编排归包（如 `/api/dashboards/*` → `@ginkgolab/app-analytics/server`，datasources 管理器经 deps 注入）。

## 5. 依赖单向

壳 → 应用 → 能力 → 协议；应用间、能力间互不 import（经协议层类型解耦）。

::: warning 领域中立红线
`packages/ginkgo-llm` 禁止任何应用领域语义——prompt/工具/交付物文案一律经 `resolveAppPrompt` / `resolveAppTools` / `deliverable` / `onTaskFinish` 四接缝由应用包注入。
:::

## 配套约束

### 主题维护

- **唯一颜色事实来源**：`src/app/globals.css`，所有颜色是 CSS 变量（oklch），经 `@theme inline` 桥接为 Tailwind 类；
- **禁止硬编码色板类**（`bg-slate-50` 等），eslint `no-restricted-syntax` 直接报错，颜色一律用语义 token；
- 暗色模式跟随系统 `prefers-color-scheme`，组件侧不写 `dark:` 类；
- 完整 token 清单见 [主题 Token 规范](/theme-tokens)。

### 数据源零硬编码

- 代码里不写死任何数据源（id/名称/产品名），全部由用户配置驱动；
- 跨源联合分析由 `config/cross-source-map.json` 的 `mappings` 驱动——「映射存在且双侧源当前激活」时跨源工具、提示词规则、欢迎语宣称三处经 `resolveCrossSourcePairs()` 同一判定联动开启；
- 能力宣称由应用自治：依赖数据源的特性开关由服务端 `/api/datasources` 的 `features` 下发，客户端不做本地推断。

### 应用包边界

应用包**禁止**穿透宿主：tsconfig 不得配置 `@/*` 指向宿主 `src/`；需要的共享渲染/UI 基建从 `@ginkgolab/components` 取或包内自持。
