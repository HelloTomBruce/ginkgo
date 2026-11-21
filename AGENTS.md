# 项目指南

## 平台应用架构

- 本项目是 **OpenUI 智能体应用平台**（不是单一定制产品）：`packages/apps/*` 是可插拔应用，宿主 `src/` 是应用无关壳，`packages/openui-llm` 是**领域中立**编排层（禁止加入任何应用领域语义——prompt/工具/交付物文案一律经 `resolveAppPrompt`/`resolveAppTools`/`deliverable`/`onTaskFinish` 四接缝由应用包注入）。
- 新应用接入（manifest/插槽/服务端契约/产物协议/注册）唯一规范：[docs/app-integration-guide.md](docs/app-integration-guide.md)。
- 应用包**禁止**穿透宿主：tsconfig 不得配置 `@/*` 指向宿主 `src/`；需要的共享渲染/UI 基建从 `@openui-analytics/components` 取或包内自持。
- 宿主组合根（`src/lib/analyticsRuntime.ts`、`src/lib/apps/runtimeServers.ts`、`src/app/api/analyze/route.ts`）是唯一允许 appId 装配特判的位置。

## 主题维护

- **唯一颜色事实来源**：`src/app/globals.css`。所有颜色都是那里定义的 CSS 变量（oklch），经 `@theme inline` 桥接为 Tailwind 类。
- **禁止硬编码色板类**（`bg-slate-50`、`dark:text-blue-400` 等），eslint `no-restricted-syntax` 会直接报错。颜色一律用语义 token：`bg-card`、`text-foreground-subtle`、`bg-info-soft`、`text-success-fg` 等。
- **暗色模式跟随系统** `prefers-color-scheme`，无手动开关；暗色值在 globals.css 底部的暗色媒体查询块里覆写 token，组件侧不写 `dark:` 类。
- **图表颜色**用 `var(--chart-1..6)` / 语义 solid token，直接写进 SVG 属性或 inline style。
- 完整的 token 清单与「旧类 → token」映射表见 [docs/theme-tokens.md](docs/theme-tokens.md)。
- 新增颜色需求：先在 globals.css 加 token（亮暗双套），再在组件里引用。

## 数据源零硬编码

- **代码里不写死任何数据源**（id/名称/产品名）：数据源全部由用户在「设置 → 数据源」或 `config/datasources.json` 配置，代码不得用关键词嗅探源 id/name 来推断能力。
- **跨源联合分析**：由 `config/cross-source-map.json` 的 `mappings` 驱动（注册表在 `packages/apps/app-analytics/src/server/crossSource.ts`）——每条映射自带双侧数据源 id；「映射存在且双侧源当前激活」时 `cross_source_link` 工具、提示词规则段、欢迎语宣称三处经 `resolveCrossSourcePairs()` 同一判定联动开启，否则全部不出现。
- **能力宣称**：产品能力注册表在 `src/lib/capabilities.ts`；依赖数据源的能力声明 `requiresFeature`，特性开关由服务端 `/api/datasources` 的 `features` 下发，客户端不做本地推断。新会话欢迎语由 `buildWelcomeMessage(ctx)` 生成。
- **推荐列表**：由方法卡 `presetQuery` 生成（`packages/openui-methodology`），新增方法卡即新增推荐项，不维护硬编码场景列表。

## 常用命令

- `pnpm dev`：开发服务器（端口 3006）
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`：质量门禁

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
