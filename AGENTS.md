# 项目指南

## 平台应用架构

- 本项目是 **Ginkgo 智能体应用平台**（不是单一定制产品）。分层与依赖方向（单向，禁止逆向/跨层）：
  - **L4 宿主壳 `src/`**：装配（组合根）+ 通用 UI 框架（会话流/消息时间线/设置中心）+ API 薄壳——零应用领域语义；
  - **L3 应用包 `packages/apps/*`**：领域语义全自持（prompt/工具/交付物/客户端插槽组件/声明）；
  - **L2 能力包 `packages/ginkgo-*`**：`llm`（领域中立编排）/ `sandbox`（沙箱原子工具）/ `datasources` / `components` / `chart-spec` / `methodology` / `app-sdk`（L0 协议层：契约唯一事实来源）。
- **五条底座原则**（裁决一切新代码）：
  1. **契约先行**：一切扩展点在 app-sdk 声明——client 声明 UI 能力（`dashboardToolbar`/`workspaceView`/`workspaceMount`/`messageExtensions`/`resolvePresetQueries`/快捷动作 `Component`），server 声明运行时能力（`buildSystemPrompt`/`getTools`/`needsWorkspace`/`listArtifacts`/`refreshArtifact`）；
  2. **组合根唯一**：appId→实现的绑定只在 `src/lib/apps/registry.ts` / `runtimeServers.ts` / API 薄壳路由；宿主其余代码禁止 appId 比较、缺省值散布（一律 import registry 的 `DEFAULT_APP_ID`/`getOrDefault`）；
  3. **语义声明化**：宿主区分应用的判断必须是应用声明的**数据**（布尔/枚举/子串 pattern），禁止话术正则与硬编码文案；
  4. **API 薄壳化**：Next.js 文件路由只做「拆包 → 委托应用/能力包 handler → 状态码映射」，业务校验与编排归包（如 `/api/dashboards/*` → `@ginkgolab/app-analytics/server`，datasources 管理器经 deps 注入）；
  5. **依赖单向**：壳→应用→能力→协议；应用间、能力间互不 import（经协议层类型）。
- 领域中立红线：`packages/ginkgo-llm` 禁止任何应用领域语义——prompt/工具/交付物文案一律经 `resolveAppPrompt`/`resolveAppTools`/`deliverable`/`onTaskFinish` 四接缝由应用包注入。
- 新应用接入（manifest/插槽/服务端契约/产物协议/注册）唯一规范：[docs/app-integration-guide.md](docs/app-integration-guide.md)；平台能力包扩展与第三方应用分发路线：[docs/platform-ecosystem-roadmap.md](docs/platform-ecosystem-roadmap.md)。
- 应用包**禁止**穿透宿主：tsconfig 不得配置 `@/*` 指向宿主 `src/`；需要的共享渲染/UI 基建从 `@ginkgolab/components` 取或包内自持（`ui/button`、`ui/dialog` 等原语已下沉组件包，宿主 `src/components/ui/*` 仅为别名 re-export）。
- 宿主组合根：`src/lib/apps/registry.ts`（注册表与 DEFAULT_APP_ID 唯一定义）、`src/lib/apps/runtimeServers.ts`（运行时 server 装配）、`src/app/api/analyze|dashboards|methodology|datasources/*/route.ts`（API 薄壳）——appId 装配特判仅允许在这些位置。

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
- **能力宣称**：由应用自治——`client.welcomeMessage` 是 defineApp 必填项（宿主兜底欢迎语领域中立，仅防 registry 异常形态）；依赖数据源的特性开关由服务端 `/api/datasources` 的 `features` 下发，客户端不做本地推断。
- **推荐列表**：应用经 `client.resolvePresetQueries` 插槽运行时解析（analytics = 方法卡 `presetQuery` 合并集，实现在 `@ginkgolab/app-analytics/client`）；未声明则回落静态 `client.presetQueries`。新增方法卡即新增推荐项，不维护硬编码场景列表。

## 常用命令

- `pnpm dev`：开发服务器（端口 3006）
- `pnpm dev:clean`：清掉 `.next` 后启动开发服务器（跨平台，等价 `rm -rf .next`）
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`：质量门禁
- `pnpm verify`：四道门禁串联（lint → typecheck → test → build），提交前跑这一条即可
- `pnpm storage:migrate`：把本地 `./data`/`./config` 复制到显式配置的 `GINKGO_HOME`（只复制、不删除）
- `pnpm pkg:bump <patch|minor|major|X.Y.Z>`：10 个包统一升版本（断言一致 → 写入 → 回读校验）
- `pnpm pkg:verify`：打包校验（private/license/engines/发布出口是否都指向真实产物）
- `pnpm pkg:smoke`：用本地 tarball 在临时工程模拟真实消费者安装 + 导入
- 发布：`git tag -a vX.Y.Z && git push origin vX.Y.Z` 触发 `.github/workflows/publish.yml`（详见 [docs/package-publishing.md](docs/package-publishing.md)）

> **dev 报错先清缓存**：跑过 `pnpm install`、改过 workspace 包名/依赖后，Turbopack 的
> `.next/dev` chunk 里固化的绝对路径可能失效，表现为莫名其妙的
> `Cannot find module 'next/dist/compiled/loader-runner'`、CSS loader 报错等。
> 先 `pnpm dev:clean` 再判断是不是真 bug——模块本身通常是存在的。

### 架构守卫（CI 会跑的测试）

`src/lib/architecture-guards.test.ts` 把以下约束变成可执行断言，违反即测试失败：

1. 宿主 `src/**` 不得出现具体应用的厂商 CLI 名（平台层保持零应用领域语义）；
2. 宿主 `src/**` 不得自己拼 `process.cwd() + data/config`（存储根唯一出口 `src/lib/storagePaths.ts`）；
3. 应用包/能力包不得 import 宿主 `@/`（依赖单向）；
4. `/api/apps/install` 必须保留安装开关与独立令牌门禁。

## 代码提交红线

- **严禁未经授权自动提交（强红线）**：没有用户明确要求（如用户发出“提交”、“commit”、“push”等明确指令），**绝对不允许**擅自执行 `git commit` 或 `git push`。修改完成并通过质量门禁验证后，只需向用户汇报改动详情与验证结果，静候用户明确的提交指示。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
