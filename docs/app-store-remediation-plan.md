# 应用中心与运行时安装：修复实施文档

> 对应评审：[Code Review — 应用中心（App Store）与运行时插件安装]
> 适用范围：`.gitignore` / `eslint.config.mjs` / 三个 `package.json` / `pnpm-lock.yaml` /
> `packages/apps/app-analytics` / `packages/apps/app-design` / `packages/ginkgo-app-sdk` /
> `src/components/**` / `src/lib/apps/**` / `src/lib/storagePaths.ts` / `src/app/api/apps/**`
> 状态：**已全部实施**（Phase 0–7，2026-11-26）。各 Phase 的实施记录与偏差见 §9。

---

## 0. 实施进展

| Phase | 状态 | 完成时间 | 门禁 |
|---|---|---|---|
| 0 · 基线固化 | ✅ 完成 | 2026-11-26 | `pnpm verify` 可用 |
| 1 · 打包回退 | ✅ 完成 | 2026-11-26 | lint / typecheck / test / build 全绿；隐藏全部 `dist` 后仍绿 |
| 2 · 存储根 | ✅ 完成 | 2026-11-26 | 三模式实测（默认 cwd / 显式 GINKGO_HOME / 全新安装）+ verify 全绿 |
| 3 · 注册表/门禁/引导 | ✅ 完成 | 2026-11-26 | 真实重启 e2e：装→重启→仍在；停用→403；损坏配置→降级不覆盖 |
| 4 · 安装安全/权限/卸载 | ✅ 完成 | 2026-11-26 | e2e：403 默认关闭 / 401 令牌 / 400 非法 spec / 真卸载摘盘 |
| 5 · 去领域化 | ✅ 完成 | 2026-11-26 | 宿主领域关键词 0 命中；模拟缺 CLI 时 design 降级且指引来自应用 |
| 6 · 客户端 | ✅ 完成 | 2026-11-26 | 真实浏览器：停用 design 后切换器实时消失（徽标 3→2），无需刷新 |
| 7 · 测试/文档 | ✅ 完成 | 2026-11-26 | `pnpm verify` 0；全新克隆模拟通过；架构守卫 6 条纳入 CI |

> Phase 1 实施期间发现两处与初版评审的偏差，已在下文 §2 D1、§1.2 R8 中修正说明。

---

## 0. 一句话结论

这批改动方向正确（配置驱动注册、生命周期契约、应用中心 UI），但**跳过了平台生态路线图 P1 的前置项**——启动期动态注册、能力协商闭环、权限门禁、工具门禁——直接上手做了 P2 的安装管理，因此三处硬缺陷（生产构建红、匿名安装入口、启停不生效）与两处结构性缺陷（重启失效、存储根分裂）都是**前置项缺失的下游症状**，不是孤立的 bug 修补。

修复策略因此不是「逐个打补丁」，而是**先补齐 P1 的四个前置项，再让 P2 的 UI 站在上面**。

---

## 1. 问题清单与修复策略矩阵

### 1.1 关键（阻塞合并）

| ID | 问题 | 根因 | 修复策略 | Phase |
|---|---|---|---|---|
| C1 | `pnpm build` 失败 | 三包改为预打包 `dist`，整包单模块加 `"use client"` banner → 服务端组合根拿到的 `app.manifest` 是 client reference proxy | 撤回预打包，恢复源码出口（已实测绿）；发布能力单独立项 | 1 |
| C2 | `/api/apps/install` 匿名 RCE | `npm install ${任意输入}` + `import()` 无任何校验；默认无 token 即放行 | 安装能力默认关闭 + 强制门禁 + 严格 spec 校验 + 正确模块解析 + manifest 身份校验 | 4 |
| C3 | 停用应用仍可执行 | 统一启用态门禁到全部执行入口（`isAppEnabled` / `getEnabled`） | 3（已完成） |

### 1.2 必须修

| ID | 问题 | 修复策略 | Phase |
|---|---|---|---|
| R1 | 安装的应用重启后消失 | `instrumentation.ts` 启动引导：读 `apps.json` → 解析 plugins → 动态注册；`initFromConfig` 真正接线 | 3（已完成） |
| R2 | 生产模式静默搬家数据根 | 改为**默认零变更**：`GINKGO_HOME` 显式配置才搬家，遗留 `./data` 检测生效 | 2 |
| R2b | 存储根只迁移了 2 处，其余 12 处仍用 `process.cwd()` → 分裂存储 | 全量收口到 `storagePaths`；包内路径经 deps 注入 | 2 |
| R3 | 应用清单双事实来源（磁盘 vs 打包种子） | 磁盘配置为唯一事实来源，包内种子仅作首次运行兜底 | 3（已完成） |
| R4 | 宿主硬编码应用领域知识 | 删除能力→命令映射；design 包实现 `onHealthCheck`；宿主只判定平台级能力 | 5 |
| R5 | `AppPermission` 死契约 | 按路线图 P1 落地 default-deny 工具门禁 + 安装时权限确认 | 4 |
| R6 | 配置写入非原子 + 解析失败静默回落 | `writeJsonAtomic` + 损坏备份 + 抛错（读降级/写拒绝）+ 互斥锁 | 3（已完成） |
| R7 | 卸载没有卸载 | 补 `unregister` + `npm uninstall` + 客户端错误提示 | 4 |
| R8 | ~~依赖归属错位~~ → **打包耦合（初版判断有误，已纠正）** | 保留 5 个驱动声明并在 `tsup.config.ts` 固化原因注释；真正收敛需停止内联 `@ginkgo/datasources`，归入发布里程碑 | 1（已完成） |
| R9 | 三包发包形态不一致 | 随 C1 一并回退，`app-general` 保持唯一形态 | 1 |
| R10 | `dist/` 被 ignore 但无构建前置 | 随 C1 消除依赖；同时补 `pnpm verify` 聚合门禁 | 1 |

### 1.3 建议修 / 小问题

| ID | 问题 | 修复策略 | Phase |
|---|---|---|---|
| O1 | AppStoreModal 重复 fetch | 合并为单一 effect + `AbortController` | 6 |
| O2 | `appsVersion` 死状态 / `void appsVersion` | 删除；启用态改由 `/api/apps` 驱动 | 6 |
| O3 | `get()` 注释与实现相反 | 语义定名 + 修正注释 + 单测 | 3 |
| O4 | Windows 不可用（`which`、`PATH` 冒号、`.cmd`） | 跨平台探测 `execFile(bin, ["--version"])`；`path.delimiter` | 5 |
| O5 | 健康检查无缓存 + 每请求 spawn | TTL 缓存 30s + 并发复用 | 5 |
| O6 | `AppStoreItem.health` 类型重复 | 复用 SDK `AppHealthCheckResult` | 6 |
| O7 | tsup `sqlite` 字符串补丁 + 空 catch | 随 C1 删除 | 1 |
| O8 | `isDegraded` 冗余 / 三元死分支 | 简化 | 6 |
| O9 | toggle/uninstall 失败无提示 | 接 `lib/toast` | 6 |
| N1 | packageManager 测试绕过 npm 路径 | mock `node:child_process` 覆盖真实路径 | 7 |
| N2 | cliBridge 测试依赖 hoist 现状 | 改为临时目录构造 `.bin` | 7 |
| N3 | registry 单例种子路径无覆盖 | 补引导后断言 | 7 |
| N4 | `isSourceRepo()` 每次同步读盘 | module 级缓存 | 2 |

---

## 2. 关键设计决策（ADR）

### D1 · 撤回预打包，恢复源码出口

**决策**：三个包（app-analytics / app-design / ginkgo-app-sdk）恢复 `exports → ./src/*.ts`、`private: true`，删除 `main`/`types`/`files`/`publishConfig`/`build`/`prepublishOnly`、两个 `tsup.config.ts` 与 `tsup` devDependency。**仅保留**有价值且与打包无关的依赖修正（`@ginkgo/llm` → devDependencies；移除 R8 的 5 个重复依赖）。

**实测证据**（本次评审已跑）：

| 实验 | 结果 |
|---|---|
| 现状（`dist` + `"use client"` banner） | ❌ `Failed to collect configuration for /api/apps/install` → `registry.ts:79 TypeError: Cannot read properties of undefined (reading 'id')` |
| 去掉 banner 重建 | ❌ 106 个 `PureComponent into a React Server Component`（bundle 内 recharts） |
| 恢复源码出口 | ✅ `✓ Compiled successfully` + `✓ Generating static pages (23/23)` |
| 隐藏 `dist` 后 `pnpm typecheck` | ❌ 20+ 处 `TS2307: Cannot find module '@ginkgo/app-sdk'` |

**根因**：`src/client/**` 的每个组件文件自己带 `"use client"`（15 处），Next 按**文件级**划定边界，`manifest.ts` / `index.ts` 保持服务端可用。tsup 把所有模块拍平成一个文件并把 banner 提到文件头，边界粒度丢失——要么整包变客户端（服务端拿不到 manifest），要么整包变服务端（recharts 进 RSC 报错）。两者都不可行。

**取舍**：放弃本 changeset 的「可发布」目标。理由：宿主是唯一消费者，`dist` 不带来任何收益却带红构建；而自包含发布与文件级边界天然冲突，需要「不打包 emit + 消费方 `transpilePackages` + 发布内网 registry」的独立设计，不是顺手能完成的。**发布能力移入路线图独立里程碑**（见 §8.1），并把该决策写入路线图 P2，避免意图丢失被误读成技术倒退。

**实际实施形态（Phase 1，已落地）**：未采用"完全删除 tsup/publishConfig"，而是**源码出口 + `publishConfig` 发布期覆盖**：

```jsonc
// 开发期（仓库内）：消费源码，Next 按文件级 "use client" 划边界
"main": "./src/index.ts",
"exports": { ".": "./src/index.ts" },
// 发布期：publishConfig 覆盖为打好的 dist
"publishConfig": {
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
}
```

该形态同时满足两点：仓库内构建不依赖 `dist`（全新克隆可 verify），发布意图不被删除。**遗留待验证项**：`publishConfig` 对 `main`/`exports` 的覆盖语义需在发布里程碑用 `npm pack --dry-run` 实测确认（`publishConfig` 官方保证覆盖的字段有限，社区有将其用于 `main`/`exports` 的先例，但未经本仓库验证）。若实测不成立，届时切换为 `prepublishOnly` 脚本改写 `package.json` 的方案。

三包（app-analytics / app-design / ginkgo-app-sdk）统一为该形态；`@ginkgo-apps/general` 保持 `private: true` + 源码出口（未纳入发布范围）。

### D2 · 存储根：默认零变更，显式配置才搬家

**决策**：`getGinkgoHomeDir()` 解析顺序改为：

1. `GINKGO_HOME`（显式）
2. `GINKGO_DATA_DIR`（显式，兼容旧名）
3. **遗留兼容**：`cwd/data` 或 `cwd/config` 任一存在 → 返回 `cwd`（升级即不变，零迁移）
4. 否则 → `~/.ginkgo`

删除 `NODE_ENV === "development" && isSourceRepo()` 判定——它是 R2 的根因：任何 `pnpm start` / Docker / 打包运行都会跳过 `cwd` 分支，导致存量数据凭空不可见。

**取舍**：不引入自动迁移（搬错数据的代价高于搬家收益）。仅当用户显式设置 `GINKGO_HOME` 时，启动期做一次「检测到旧目录 → 打印明确指引 + 提供 `pnpm storage:migrate` 脚本」，脚本内部用「复制 → 校验 → 提示手动删源」，不做自动删除。

### D3 · 启用态是唯一门禁轴，注册态与启用态分离

**决策**：

- `has(id)` = 已注册（**不含**启用态）；
- `isAppEnabled(id)` = 已注册 **且** 启用；
- `get(id)` = 注册项（含禁用），**修正注释**（现注释声称禁用时返回 undefined，与实现相反）；
- 新增 `getEnabled(id)` 供执行路径使用。

**所有执行入口**改用 `isAppEnabled`：`/api/apps/[appId]/action`、`resolveRuntimeServer`、`resolveAppTools`、`/api/apps/[appId]/toggle|DELETE`。`list()` / `getOrDefault()` 已正确，保持不变。

### D4 · 安装是「默认关闭的高危能力」

**决策**：新增 `GINKGO_ALLOW_APP_INSTALL`（默认 **false**）。关闭时 `POST /api/apps/install` 直接 403 并给出可操作文案；开启时该路由**额外强制** `GINKGO_APP_INSTALL_TOKEN`（不依赖全局 `GINKGO_API_AUTH_TOKEN` 是否配置），避免"全局没配 token 就裸奔"。

**理由**：本项目是本地单机、可信环境形态，全局 token 默认放行是既定姿态（`src/middleware.ts:11`）。但安装 = 任意代码执行，其风险量级与其它 `/api` 不同，不能共享同一把默认闸门。

### D5 · 权限：default-deny 工具白名单（对齐路线图 P1）

**决策**：实现路线图 §2 P1 已定义的「权限模型 v1」：manifest `permissions` → 工具类别白名单，在 `resolveAppTools`（`src/app/api/analyze/route.ts:80`）分发处执行 per-app 过滤；未声明的权限 = 无该类别工具（default deny）。安装时 UI 展示权限清单并二次确认。

映射表（`permission → 工具类别`）放在 app-sdk 契约层，能力包按类别标注，宿主只查表。

**若工期不可压缩**：备选方案是删除 `AppPermission` 与 `AppManifest.permissions`（死代码卫生），并在路线图登记待办。**本文档推荐实现**，因为它同时消除 R5 与路线图前置项「per-app 工具门禁」。

### D6 · 启动引导用 `instrumentation.ts`

**决策**：Next 16.4.6 支持 `src/instrumentation.ts` 的 `register()`。在其中（`process.env.NEXT_RUNTIME === "nodejs"` 守卫）执行：

```
loadAppsConfig()              // 磁盘为唯一事实来源
  → appRegistry.initFromConfig(config)
  → for each builtin:false 且有 package 的条目：
        resolveInstalledPackage(package) → import() → appRegistry.register()
      失败则记录为 degraded（不阻断启动）
```

幂等守卫（dev HMR 会重复调用）：模块级 `bootstrapPromise` 单飞。

**失败容忍**：单个应用载入失败不得让宿主起不来；`GET /api/apps` 返回 `isRegistered:false` + `loadError` 供 UI 展示。

---

## 3. 分阶段实施计划

依赖顺序：**P1 → P2 → P3 → P4 → P5 → P6 → P7**。P1 必须最先（解锁 `pnpm build`，否则后续所有改动无法验证生产构建）。

每个 Phase 结束：跑全门禁 → 输出验证结果 → **等待用户明确提交指令**（项目红线：未授权禁止 commit）。提交建议按 Phase 拆分，消息见各节。

---

### Phase 0 · 基线固化（0.5h）

**改动**

1. 根 `package.json` 新增聚合门禁：

```json
"verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
```

2. 记录当前红基线：`pnpm build` 的失败输出存档到 PR 描述（证明修复前后对比）。

**验收**

- `pnpm verify` 可执行，当前在 `build` 阶段失败（预期红）。
- 除上述外无代码改动。

---

### Phase 1 · 打包回退，解锁构建（2h）

**改动文件**

| 文件 | 动作 |
|---|---|
| `packages/apps/app-analytics/package.json` | 恢复 `exports → ./src/*.ts`；删 `main`/`types`/`files`/`publishConfig`/`scripts.build`/`prepublishOnly`；`private: true`；**移除** `pg`/`mysql2`/`exceljs`/`@duckdb/node-api`/`@clickhouse/client`（R8）；`@ginkgo/llm` 保持 devDependencies；删 `react`/`react-dom` peer + `peerDependenciesMeta`；删 `tsup` devDep |
| `packages/apps/app-design/package.json` | 同上（恢复三出口、删 build/publish/peer/tsup） |
| `packages/ginkgo-app-sdk/package.json` | 恢复 `exports → ./src/index.ts`、`private: true`、删 build/publish/peer/tsup |
| `packages/apps/app-analytics/tsup.config.ts` | 删除（O7 随之消失） |
| `packages/apps/app-design/tsup.config.ts` | 删除 |
| `pnpm-lock.yaml` | 随 `pnpm install` 再生成 |
| `.gitignore` | 保留 `dist/`（未来发布构建仍需要），`*.tsbuildinfo` 保留 |
| `eslint.config.mjs` | 保留 `**/dist/**` 忽略（无害且面向未来） |

**要点**

- R8 的关键判断：这 5 个驱动**只被** `packages/ginkgo-datasources/src/connectors/**` import（已 grep 确认），app-analytics 通过 `workspace:*` 传递依赖即可。未来若发布 app-analytics，正确表达是 `@ginkgo/datasources` 用 `peerDependenciesMeta.optional`，而非在应用包重复声明。
- R9 由本 Phase 自然消除：三包全部回归源码出口，与 `app-general` 形态一致。
- R10 由本 Phase 自然消除：不再依赖 `dist`，全新克隆无需预构建。

**验收**

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build                      # 必须 ✓ Compiled successfully + 生成 23 个静态页
rm -rf packages/*/*/dist         # 模拟全新克隆（dist 已无用）
pnpm typecheck && pnpm build     # 必须仍然绿
```

**提交**：`fix(packaging): 撤回应用包预打包，恢复源码出口并归位依赖`

---

### Phase 2 · 存储根统一与遗留兼容（4h）

**改动文件**

| 文件 | 动作 |
|---|---|
| `src/lib/storagePaths.ts` | 重写解析顺序（D2）；删 `isSourceRepo()`，改「遗留目录探测」；加 `writeJsonAtomic`；module 级缓存（N4） |
| `src/lib/sessionStore.ts` / `workspaceStore.ts` | 已迁移，改用 `writeJsonAtomic`（R6 复用） |
| `src/lib/mcpStore.ts:13` | `process.cwd()` → `getStoragePath("config","mcp-servers.json")` |
| `src/lib/datasources.ts:15-16` | → `getStoragePath("config","datasources.json")` / `getFileStorageDir()`（消除 `getFileStorageDir` 0 引用） |
| `src/lib/workspaceResolver.ts:9` | → `getStoragePath("data","workspaces")` |
| `packages/ginkgo-llm/src/handler.ts:157` | tokenizer 路径改为**可选注入**，默认值保留 cwd（能力包不穿透宿主） |
| `packages/ginkgo-harness-core/src/finops/costLedger.ts:61,208` | 同上，`opts.pricingPath` / `opts.filePath` 已存在，宿主注入 |
| `packages/apps/app-analytics/src/server/{dashboardStore.ts:861,index.ts:172,methodologyLoader.ts:23,crossSource.ts:46}` | 经 `createAnalyticsServer(deps)` factory 注入（宿主组合根已有装配点） |
| `packages/apps/app-general/src/server/index.ts:24`、`app-design/src/server/tools.ts:214` | 经 `ctx.workspaceDir` / sandbox 上下文注入，删除自算 cwd |
| `scripts/storage-migrate.mjs`（新增） | 复制 → 校验 → 提示删源；不做自动删除 |
| `docs/guide/environment-variables.md` | 补 `GINKGO_HOME` / `GINKGO_DATA_DIR` 语义与默认值表格 |

**要点**

- **架构红线**：`packages/**` 不得 import `@/lib/storagePaths`（宿主路径穿透）。包侧一律经既有 factory / ctx 注入，宿主在组合根（`src/lib/apps/runtimeServers.ts`、`src/lib/analyticsRuntime.ts`、`src/app/api/analyze/route.ts`）传入绝对路径。
- **分裂存储是本次最易被低估的问题**：现状下 sessions/workspaces 已搬到 `~/.ginkgo`，而 dashboards/files/mcp/datasources/cost-ledger 仍在 `cwd` —— 生产模式下看板会引用留在原地的 `data/files` 而失败。必须一次性收口，禁止分批。
- 默认行为必须与升级前完全一致（`./data`、`./config`），否则视为回归。

**验收**

```bash
# A. 默认（仓库内有 ./data）→ 解析到 cwd
node -e "process.env.NODE_ENV='production'; import('./src/lib/storagePaths.ts')" # 或经 vitest
# B. 显式 GINKGO_HOME=/tmp/x → 解析到 /tmp/x
# C. 无 GINKGO_HOME 且无 ./data → ~/.ginkgo
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

新增单测：三分支解析、遗留目录优先、`writeJsonAtomic` 崩溃不产生半截文件。

**提交**：`fix(storage): 统一数据根解析并收口全部 cwd 存储路径`

---

### Phase 3 · 注册表、启用态门禁、启动引导、原子持久化（6h）

**改动文件**

| 文件 | 动作 |
|---|---|
| `src/lib/apps/registry.ts` | 语义分离（D3）；新增 `unregister(id)`；`initFromConfig` 幂等；删静态 `initialAppsConfig` 直接构造（保留为同步种子兜底，注释说明被引导期覆盖） |
| `src/app/api/apps/[appId]/action/route.ts:31` | `has()` → `isAppEnabled()`，403 文案区分「不存在」与「已停用」 |
| `src/lib/apps/runtimeServers.ts:17` | `get()` → `getEnabled()` |
| `src/app/api/analyze/route.ts:62,80` | `resolveAppPrompt` / `resolveAppTools` 前置启用态判定 |
| `src/lib/apps/appConfigServer.ts` | `writeJsonAtomic`；`loadAppsConfig` 区分 ENOENT 与解析损坏（损坏 → 备份 `.bak` + 抛错/告警，绝不静默返回出厂配置） |
| `src/instrumentation.ts`（新增） | D6 引导流程 |
| `src/lib/apps/packageManager.ts` | 抽出 `resolveInstalledPackage()`（供安装与引导共用）；新增 `registerInstalledApps()` |
| `src/app/api/apps/route.ts` | 以磁盘配置为唯一列表源；补 `isRegistered:false` 时的 `loadError` 字段 |

**`loadAppsConfig` 新契约**

```ts
// 文件不存在 → 返回 bundled seed（首次运行，正常）
// 文件存在但 JSON 损坏 → 备份 apps.json.corrupt-<内容哈希>，抛 AppsConfigCorruptError
//   调用方（GET /api/apps）降级返回 seed + warning 字段，写操作直接失败
```

**引导骨架**（实际实现见 `src/instrumentation.ts`：先解析存储根并下发
`GINKGO_RESOLVED_HOME`，再 `bootstrapApps()`；两者都用动态 import 以免把应用包
依赖图拖进 instrumentation 编译单元）

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  getGinkgoHomeDir();                                   // 下发存储根
  await bootstrapApps();                                // 内建 + 已安装应用注册
}
```

**验收**

- 安装一个应用 → **重启 dev server** → `GET /api/apps` 中该应用 `isRegistered:true`、`enabled` 保持安装时的值；
- 停用 design → `POST /api/apps/design/action` 返回 403；`/api/analyze` 携带 design 的会话回落 analytics 并记录一次告警；
- 手动写入损坏的 `apps.json` → 启动/请求不崩、产出 `.bak`、日志明确；
- 单测：`unregister` 后 `has/list/getEnabled` 全部一致；损坏配置路径。

**提交**：`fix(apps): 启用态统一门禁 + 启动引导回灌 + 配置原子持久化`

---

### Phase 4 · 安装安全加固、权限门禁、真卸载（8h）

**改动文件**

| 文件 | 动作 |
|---|---|
| `src/app/api/apps/install/route.ts` | D4 门禁（`GINKGO_ALLOW_APP_INSTALL` + `GINKGO_APP_INSTALL_TOKEN`）+ 严格 spec 校验 |
| `src/lib/apps/packageManager.ts` | `installPackage` 重写解析与校验；`uninstallPackage` 补真卸载；进程内安装互斥锁 |
| `src/lib/apps/appSpec.ts`（新增） | spec 校验 + 模块解析（`resolveInstalledPackage`）单一实现 |
| `packages/ginkgo-app-sdk/src/types.ts` | `AppPermission` → 工具类别映射表；`AppManifest.package` 语义注释 |
| `src/app/api/analyze/route.ts` | `resolveAppTools` 按 manifest `permissions` 过滤（default deny） |
| `src/components/chat/AppStoreModal.tsx` | 安装前展示权限清单确认；失败 toast |
| `docs/guide/environment-variables.md` | 新增两个 env 说明 |

**spec 校验规则（拒绝即 400）**

```
允许：@scope/name | @scope/name@1.2.3 | @scope/name@^1.2.3 | file:/abs/path.tgz(需开关)
拒绝：含 ".."、绝对路径穿越、空格、; & | $ ( ) ` 引号、非 @scope 形式的裸名（除非内置白名单）
上限：长度 ≤ 214
```

**模块解析（替换 `path.join + import`）**

```ts
const req = createRequire(path.join(pluginsDir, "package.json"));
const entry = req.resolve(packageName);          // 由 Node 解析，天然处理 scope/版本/入口
const { default: pkg } = await import(pathToFileURL(entry).href);
```

**manifest 身份校验**

- `manifest.id` 匹配 `^[a-z][a-z0-9_-]{1,63}$`；
- 不得与 `BUILTIN_APP_PACKAGES` 的 id 冲突（防内置应用被第三方覆盖）；
- `manifest.package`（若声明）必须等于实际安装的包名（防「装 A 冒名 B」）；
- 校验通过才执行 `onInstall`（钩子执行前完成权限确认）。

**真卸载顺序**

```
onUninstall → npm uninstall <pkg> (cwd=pluginsDir) → appRegistry.unregister → 配置移除 → 清 enabledStates → 释放锁
```

**验收**

- 未开开关时 `curl -X POST /api/apps/install` → 403；
- `packageSpec = "../../etc/passwd"` → 400；
- `packageSpec = "@demo/app@1.0.0"`（真实 scope+版本）能装能载入（此前必然失败）；
- 卸载后插件目录内该包消失、`/action` 返回 404、`apps.json` 无残留；
- design 未声明 `datasources.read` → 其工具集中无数据源类工具（default deny 单测）；
- 安装一个声明 `permissions:["shell.execute"]` 的 mock 包 → UI 弹出权限清单。

**提交**：`feat(apps): 安装能力门禁与权限白名单门禁，补齐真卸载`

---

### Phase 5 · 宿主去领域化与跨平台探测（4h）

**改动文件**

| 文件 | 动作 |
|---|---|
| `src/lib/apps/capabilityNegotiator.ts` | 删除 `claude_design`/`claude_data`/`zentao_cli` 的 if/else 硬编码（R4）；只判定**平台级**能力（`sql_query`/`chart_spec`/`methodology`/`workspace_sandbox`/`filesystem`/`bash`/`browser`）；CLI 类能力一律委托应用 `onHealthCheck`；TTL 缓存 30s（O5）；`hasCommand` 跨平台（O4） |
| `packages/apps/app-design/src/index.ts`（或 `manifest.ts`） | 实现 `lifecycle.onHealthCheck`：探测 `claude-design` 与 `claude-design-system`，返回 `missing_capabilities` + `remediationGuide` |
| `packages/apps/app-design/src/server/cliBridge.ts` | `resolveBinExecutable` 支持 Windows（`.cmd`/`.exe`）；`PATH` 拼接用 `path.delimiter`（O4） |

**`hasCommand` 跨平台实现**

```ts
async function probeCommand(bin: string): Promise<boolean> {
  try { await execFileAsync(bin, ["--version"], { timeout: 5_000 }); return true; }
  catch (e) { return (e as {code?:string}).code !== "ENOENT"; }  // 非 ENOENT 视为存在
}
```

**验收**

- 全仓 grep 无 `claude_design` / `claude-data` / `zentao` 字样出现在 `src/**`（宿主零领域语义）；
- design 缺 CLI 时 `GET /api/apps` 返回 `missing_deps` + 应用自带的修复指引；
- 连续 5 次 `GET /api/apps` 只产生 1 次真实探测（缓存命中，可断言调用次数）。

**提交**：`refactor(apps): 健康检查下沉应用自治并跨平台化能力探测`

---

### Phase 6 · 客户端修整（3h）

**改动文件**

| 文件 | 动作 |
|---|---|
| `src/components/chat/AppStoreModal.tsx` | 合并重复 fetch（O1）；`AbortController` 清理；toggle/uninstall 失败 toast（O9）；`isDegraded` 冗余删除（O8）；`health` 类型复用 SDK `AppHealthCheckResult`（O6）；权限确认弹层（Phase 4 产出） |
| `src/components/ChatDashboard.tsx` | 删除 `appsVersion` / `void appsVersion` 死状态（O2）；改为持有 `enabledAppIds`（来自 `GET /api/apps`），`activeApp` 计算走「启用集合优先，否则回落 DEFAULT_APP_ID」；`handleSwitchApp` 用启用态判定 |
| `src/components/chat/AppSwitcher.tsx` | `apps` 由父级传入已启用列表，删除默认值 `listApps()`（避免静态清单与真实状态不符） |
| `src/components/chat/ChatSidebar.tsx` | 透传同上 |

**要点**：客户端**不得**再以 `appRegistry` 的启用态作为真相——它是打包期常量。启用态唯一来源是 `GET /api/apps`；`appRegistry` 在客户端只用于拿 manifest 静态信息（名称/图标/插槽）。

**验收**

- 停用当前应用 → 侧栏应用列表不再出现该项，`activeApp` 回落 analytics，无需刷新页面（或明确提示刷新）；
- 安装/卸载失败时出现 error toast；
- `AppStoreModal` 打开只发一次 `GET /api/apps`（`fetch` 调用计数断言）；
- 快捷搜索/分类/健康提示行为不变（既有测试保持绿）。

**提交**：`refactor(chat): 应用中心客户端状态与真实启用态对齐`

---

### Phase 7 · 测试补齐、文档、全量验收（5h）

**测试补齐（对应 1.3 的 N 项 + 各 Phase 缺口）**

| 用例 | 覆盖 |
|---|---|
| `packageManager.test.ts` | mock `node:child_process` 后走真实 `npm install` 分支；spec 拒绝矩阵（8 条）；解析失败降级 |
| `appSpec.test.ts`（新） | spec 正则边界 + `resolveInstalledPackage`（临时目录构造 `node_modules/@scope/name`） |
| `cliBridge.test.ts` | 改临时目录构造 `.bin/<tool>`，不依赖 hoist（N2） |
| `registry.test.ts` | 补「真实种子配置 → 单例含三内置应用」；`unregister` 语义；`get` 禁用态返回（N3、O3） |
| `storagePaths.test.ts` | 三分支 + 遗留目录 + 原子写（N4 缓存行为） |
| `bootstrap.test.ts`（新） | 磁盘配置驱动注册、单应用载入失败不阻断、幂等 |
| `route.test.ts` | 安装门禁 403、权限 default-deny、停用后 action 403 |
| `AppStoreModal.test.tsx` | 单一 fetch、错误 toast、权限确认 |

**文档**

1. `docs/app-integration-guide.md`：包出口形态（源码出口 + 不打包原因）、`lifecycle` 四钩子契约、`permissions` 声明与门禁语义、`onHealthCheck` 写法、`manifest.package` 校验规则。
2. `docs/platform-ecosystem-roadmap.md`：P1 勾选已完成项（动态注册/能力协商闭环/权限 v1）；P2 记录「预打包发布」为独立里程碑及其约束（不打包 emit + `transpilePackages` + 文件级 `"use client"` 保持）。
3. `docs/guide/environment-variables.md`：`GINKGO_HOME`、`GINKGO_DATA_DIR`、`GINKGO_ALLOW_APP_INSTALL`、`GINKGO_APP_INSTALL_TOKEN`。
4. `docs/.vitepress/config.mts`：如需入站，在「深度文档」注册本文件。
5. 本文档末尾回填「实施结果」表（每 Phase 实际耗时、偏差、遗留）。

**全量验收**

```bash
pnpm verify    # lint && typecheck && test && build —— 四门禁全绿
```

手工验收剧本（写入 PR 描述）：

```
1. 全新克隆 → pnpm install → pnpm verify            ✅ 无预构建需求
2. pnpm dev → 打开应用中心 → 停用 design             ✅ 侧栏消失、无法调用其动作
3. 开启 GINKGO_ALLOW_APP_INSTALL=1 装 @ginkgo-apps/analytics（本地 tarball）
4. 重启 dev server                                  ✅ 应用仍在、状态保持
5. 卸载                                             ✅ 目录/配置/注册表三处清空
6. 关闭开关后 curl install                           ✅ 403
7. pnpm start（生产模式）                            ✅ 数据仍在 ./data，无搬家
```

**提交**：`test+docs(apps): 补齐应用生态测试覆盖与接入规范`

---

## 4. 实施顺序与工期

```
Phase 0 (0.5h) ─→ Phase 1 (2h) ─→ Phase 2 (4h) ─→ Phase 3 (6h)
                                                        │
                                                        ▼
                              Phase 7 (5h) ←─ Phase 6 (3h) ←─ Phase 5 (4h) ←─ Phase 4 (8h)
```

| Phase | 内容 | 工期 | 阻塞关系 |
|---|---|---|---|
| 0 | 基线 + `verify` 脚本 | 0.5h | — |
| 1 | 打包回退 | 2h | 解锁 `build`，**必须最先** |
| 2 | 存储根 | 4h | 依赖 1 |
| 3 | 注册表/门禁/引导/持久化 | 6h | 依赖 2（引导期需正确路径） |
| 4 | 安装安全/权限/卸载 | 8h | 依赖 3（`unregister`、启用态） |
| 5 | 去领域化/跨平台 | 4h | 依赖 3（健康检查缓存与门禁共用） |
| 6 | 客户端 | 3h | 依赖 3、4（需要真实启用态与权限字段） |
| 7 | 测试/文档/验收 | 5h | 依赖全部 |
| **合计** | | **32.5h ≈ 4 人日** | |

**可并行的**：Phase 5 与 Phase 4 无强依赖，可并行；Phase 6 的 O1/O2/O8/O9 可与 Phase 5 并行启动（权限确认弹层必须等 Phase 4）。

---

## 5. 风险与回滚

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| Phase 1 回退后发布意图丢失 | 团队仍期待 npm 分发 | 路线图登记独立里程碑（Phase 7），PR 描述显式说明"暂缓非放弃" |
| Phase 2 改动面广（12 处 cwd） | 漏改一处 → 分裂存储 | 加 lint 规则/CI grep：`src/**` 禁止出现 `process.cwd()` 拼 `data`/`config`；纳入 Phase 7 |
| Phase 3 引导影响启动 | 某应用载入抛错阻断启动 | 单应用失败隔离 + 全局 try/catch + 超时 10s；dev 环境下允许启动继续 |
| Phase 3 dev HMR 重复引导 | 热重载重复注册 | 模块级单飞 Promise + `unregister` 幂等 |
| Phase 4 权限门禁误伤内置应用 | 内置应用未声明 `permissions` | 内置应用集中补齐声明，并在合并前跑一遍三应用工具快照对比（工具数量不得减少） |
| Phase 5 健康检查下沉后能力探测退化 | design 缺探测实现 | 保留宿主对平台能力的兜底判定；应用未实现钩子时返回 `ready` + 日志提示 |
| 逐 Phase 提交但中间态不可用 | 只跑了部分 Phase | 每个 Phase 都必须 `pnpm verify` 全绿才提交；不允许"下个 Phase 修上次的红" |

**回滚粒度**：按 Phase 单独 revert。Phase 1 与其它 Phase 无代码交叉，可独立回滚；Phase 2/3 强耦合，需成对回滚。

---

## 6. 验收清单（逐条对应评审 26 项）

| 编号 | 验收动作 | 期望 | Phase |
|---|---|---|---|
| C1 | `pnpm build` | 绿，23 页 | 1 |
| C1 | 删 `dist` 后 `pnpm typecheck && pnpm build` | 绿 | 1 |
| C2 | 关开关 HTTP 打 install | 403 | 4 |
| C2 | `packageSpec` 注入 `../../etc/passwd` | 400 | 4 |
| C2 | scope+版本 spec 安装 | 成功载入 | 4 |
| C3 | 停用应用打 action | 403 | 3 |
| R1 | 安装后重启 | 状态保持、可用 | 3 |
| R2 | `pnpm start` | 数据仍在 `./data` | 2 |
| R2b | grep `process.cwd()` + data/config | 0 命中 | 2 |
| R3 | 磁盘改 enabled → 重启 | 生效且一致 | 3 |
| R4 | grep `claude_design` in `src/**` | 0 命中 | 5 |
| R5 | 未声明权限的应用 | 无该类工具 | 4 |
| R6 | 损坏 apps.json | 不静默覆盖、产出 `.bak` | 3 |
| R7 | 卸载后查目录/配置/注册表 | 三处清空 | 4 |
| R8 | app-analytics deps | 无 5 个驱动 | 1 |
| R9 | 三包 + general exports 形态 | 一致（源码出口） | 1 |
| R10 | 全新克隆 | 无需预构建即可 verify | 1 |
| O1–O9 | 见 §1.3 | 对应验收见各 Phase | 3/5/6 |
| N1–N4 | 见 §7 测试表 | 测试绿且不依赖环境 | 7 |

---

## 7. 与项目原则的一致性自查

| 原则 | 本方案如何满足 |
|---|---|
| 契约先行 | `AppPermission` 映射、`lifecycle` 四钩子、`manifest.package` 全部落在 `@ginkgo/app-sdk`；宿主不新增应用领域分支 |
| 组合根唯一 | 路径注入、健康探测、权限门禁的装配点集中在 `runtimeServers.ts` / `analyze/route.ts` / 新增 `bootstrap.ts`；`src/lib/apps/**` 不出现 `claude-*`、`zentao` 等字样 |
| 语义声明化 | 能力探测由应用 `onHealthCheck` 声明；权限由 manifest 数据声明，宿主只查表 |
| API 薄壳化 | install/toggle/delete 路由保持「拆包 → 委托 → 状态码映射」；校验逻辑下沉 `appSpec.ts` / `packageManager.ts` |
| 依赖单向 | Phase 2 明确禁止 `packages/**` import `@/lib/*`；路径经 factory/ctx 注入 |
| 主题维护 | AppStoreModal 仅使用语义 token（现状已合规），新增 UI 沿用同一套 |
| 数据源零硬编码 | 本方案不引入数据源嗅探；R4 修复反而清除了宿主对应用能力的硬编码 |

---

## 8. 附：需要同步更新的项目级文档

### 8.1 路线图新增条目（P2 段）

> **预打包发布（独立里程碑）**：当前仓库形态下应用包以源码 `.ts` 出口被 Next 直接编译，靠**文件级** `"use client"` 维持 RSC 边界。要对外发布 npm 包，必须满足三条：①构建为**不打包**的 ESM（保留每文件指令）；②消费方配置 `transpilePackages`；③CI 增加 `next build` 冒烟。任何"整包 bundle + 全局 banner"的方案都会破坏边界（评审已实测：单包 bundle 时服务端 `manifest` 为 undefined，去掉 banner 则 recharts 进入 RSC 报 106 错）。
>
> 同里程碑需一并决策：**`@ginkgo/datasources` 是否继续内联进 `dist/server.js`**。当前内联（`noExternal`）迫使 app-analytics 显式声明 5 个数据库/文件驱动；改为正常 npm 依赖可消除该耦合。另需用 `npm pack --dry-run` 验证 `publishConfig` 对 `main`/`exports` 的覆盖是否生效。

### 8.2 AGENTS.md 增补建议

在「常用命令」补 `pnpm verify`；在「代码提交红线」旁补充「新增/变更 `/api/**` 写操作必须先声明鉴权姿态」。

---

## 9. 实施结果回填（实施后填写）

| Phase | 计划 | 实际 | 偏差说明 |
|---|---|---|---|
| 0 | 0.5h | 0.2h | 新增根治 `verify` 脚本，无偏差 |
| 1 | 2h | 1.0h | 进入时发现工作树已部分修复（analytics/design 改为源码出口 + `publishConfig`），承接现状收尾而非重写；剩余 gap 是 **app-sdk 仍指向 dist**（隐藏 dist 后 typecheck 崩 20+ 处，已实测） |
| 2 | 4h | 3.5h | 12 处 cwd 按「宿主 / 能力包 / 应用包」三档处理，详见 §9.2；顺带把 instrumentation 的存储引导提前落地 |
| 3 | 6h | 6.5h | 超出 0.5h：e2e 暴露两个只有真实运行才发现的问题（Turbopack 改写动态 import、损坏备份无限堆积），详见 §9.3 |
| 4 | 8h | 6h | 提前 2h：权限模型收敛为「声明式映射 + 纯函数」，比预估的启发式归类更简单 |
| 5 | 4h | 3h | 收敛为「契约 + 调度」两层，未引入新包 |
| 6 | 3h | 3.5h | 多花 0.5h 在 React 19 的 `set-state-in-effect` 规则上：两处级联写法被 lint 拦下，改为 promise 回调与事件驱动 |
| 7 | 5h | 4h | 额外修掉一处测试隔离缺陷（存储根缓存未重置），并处理了「两套模块图各留一份备份」 |

### 9.1 Phase 1 偏差记录

1. **R8 判断纠正**：初版评审称 5 个数据库驱动是"依赖归属错位、应删除"。实测 `dist/server.js` 确认 `@ginkgo/datasources` 被 `noExternal` 内联，而 `pg`/`mysql2`/`@duckdb/node-api`/`exceljs`/`@clickhouse/client` 被外部化为裸 import——因此发布产物运行时**确实需要**这些依赖，本包声明它们是正确的。已改为在 `packages/apps/app-analytics/tsup.config.ts` 顶部写入原因注释，防止后人"顺手清理"引入发布期故障。真正的收敛方式是停止内联 `datasources`，属于发布里程碑决策。
2. **D1 实施形态调整**：未完全删除 `tsup`/`publishConfig`，改为源码出口 + 发布期覆盖（见 §2 D1「实际实施形态」）。原因是工作树已由他人做出该方向的部分修复且验证可用，承接比推翻更省风险。
3. **O7 处理方式变更**：因 `tsup` 保留，`fixNodeSqliteImport` 未被删除，而是消除静默失败（读失败/写失败分别 `console.warn`，并补注释说明这是打包器兜底补丁、打包器修正后应删除）。

### 9.2 Phase 2 实施记录：12 处 `process.cwd()` 的分档处置

| 分档 | 位置 | 处置 |
|---|---|---|
| **宿主（3 处）** | `mcpStore.ts`、`datasources.ts`、`workspaceResolver.ts` | 直接改用 `storagePaths` 命名访问器；`mcpStore`/`workspaceStore` 的写路径同时切到 `writeJsonAtomic` |
| **应用包（5 处）** | app-analytics：`dashboardStore`、`methodologyLoader`、`crossSource`、`server/index`（certified queries）；app-general / app-design 的 workspace 兜底 | analytics 新增 `src/server/storage.ts`（读 `GINKGO_HOME`/`GINKGO_RESOLVED_HOME`，惰性求值），4 处全部改为惰性解析；general/design 各加 `resolveWorkspaceRoot()` 兜底对齐（`ctx.workspace` 仍是首选） |
| **能力包（2 处）** | `@ginkgo/llm` tokenizer 映射；`@ginkgo/harness-core` 的 `ModelPricingTable` / `NdjsonCostLedger` 默认值 | llm 新增 `tokenizerConfigPath` 选项，宿主注入；pricing 由宿主注入 `new ModelPricingTable(真实路径)`。harness-core 的两处默认值**保留 cwd**——它们是「库默认、调用方须显式传路径」的语义，且宿主从不构造 `HarnessCore`，不构成分裂存储 |
| **非存储（2 处）** | app-design `cliBridge` 的 `node_modules/.bin` 寻址 | 不是存储路径，保留（跨平台问题另见 Phase 5 O4） |

**关键实现细节**：`getGinkgoHomeDir()` 解析后把结果写入 `GINKGO_RESOLVED_HOME`。能力包/应用包禁止 import 宿主模块，统一经该环境变量读取同一存储根；`src/instrumentation.ts` 在服务端启动期最先触发解析，保证包内模块级单例不会先回退到 cwd。

**三模式实测**（`next start` 真实进程，非单测）：

| 模式 | 启动日志 | `/api/apps` |
|---|---|---|
| 默认（仓库内已有 `./data`） | `[storage] 数据根: /Users/zhangbei/code/ginkgo` | 200，3 个应用 |
| 显式 `GINKGO_HOME=/tmp/...` | 数据根随之外移 + 打印「本地与显式根并存、不自动迁移」告警 | 200 |
| 迁移助手 `--dry-run` | 正确识别 39 个待复制文件，不写入 | — |

**测试**：`storagePaths.test.ts` 重写为 11 个用例，穷举三分支（含 `NODE_ENV=production` 下的历史布局回归）、缓存语义、`GINKGO_RESOLVED_HOME` 下发、`writeJsonAtomic` 原子性（无临时文件残留 / 覆盖不留半截）。

### 9.3 Phase 3 实施记录：三个只有真实运行才会暴露的问题

单测与 `tsc` 全绿并不代表功能可用。本 Phase 的三处关键缺陷都是在 `next start` 真实进程里才现形的：

1. **Turbopack 改写了动态 import**（阻塞级）
   `import(pathToFileURL(entry).href)` 在构建产物里报 `Cannot find module as expression is too dynamic` —— 打包器把 `import(变量)` 换成了内置 loader，无法处理任意绝对路径。而用 `new Function("return import(p)")` 绕开打包器后，vitest 的 vm 沙箱又报 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`。
   **最终方案**：`loadModuleFromFile()` 双通道兜底 —— 先 `createRequire(entryPath)`（vm 与 Node ≥22.12 均可，支持 require(esm)），失败再走 Function 构造的原生 `import()`（绕开打包器）。两条通道各有对方不可替代的运行时，注释里写明了原因。

2. **损坏配置的备份会无限堆积**
   首版 `backupCorruptFile` 用 `Date.now()` 命名，而 `loadAppsConfigWithFallback` 在启动引导与**每个** GET 请求里都会调用 —— 一个坏文件每个请求新增一份 `.corrupt-*`。已改为进程内按路径记忆（`corruptBackupCache`），并补了「三次降级只产生一份备份」的回归用例。

3. **报告口径含糊**
   "已注册 N 个应用" 原本取 `list()`（只含启用项），停用应用不计入，日志与真实注册数不符。已补 `appRegistry.getRegisteredIds()`，报告区分 `registeredAppIds` / `enabledAppIds`。

**真实重启 e2e 结果**（临时 `GINKGO_HOME` + 手工放置的 `@demo/app` 第三方包）：

| 步骤 | 结果 |
|---|---|
| 首次启动 | `[apps] 已注册 4 个应用（启用 3 个）`；`GET /api/apps` 中 demo `isRegistered=true` |
| `POST /api/apps/demo/toggle {enabled:false}` | 200，磁盘 `apps.json` 落盘 |
| 停用后 `POST /api/apps/demo/action` | **403 `App disabled`**（此前会照常分发） |
| 未注册应用 action / 卸载内置 / 卸载不存在 | 404 / 400 / 404（语义正确） |
| **重启进程** | demo 仍 `isRegistered=true`、`enabled=false`，动作仍 403 |
| 写入损坏 `apps.json` 后启动 | 200 + `warning`，内置三应用照常，损坏文件**原样保留**并产出备份 |

---

*文档生成时间：2026-11-26 · 基于工作树 `main` 未提交改动（21 改 + 18 新）的完整评审结论*

### 9.4 Phase 4 实施记录：安装信任边界与权限模型 v1

**安装链路的三道闸门**（`src/app/api/apps/install/route.ts`）：

1. `GINKGO_ALLOW_APP_INSTALL=1` 显式开启（默认 403）；
2. `GINKGO_APP_INSTALL_TOKEN` 配置后强制 `x-ginkgo-install-token` 匹配（401）；
3. spec 白名单校验（`appSpec.validatePackageSpec` → 400）。

**为什么 spec 校验是白名单而非黑名单**：`packageSpec` 直接来自请求体，最终喂给 `npm install` 并被 `import()` 执行。白名单正则 `^@scope/name(@semver)?$` 天然排除 shell 元字符、空白与裸包名；`..` 单独拦截以给出明确文案；本地 tarball 需 `GINKGO_ALLOW_LOCAL_APP_PACKAGE=1`。校验与模块解析统一收敛到 `src/lib/apps/appSpec.ts`：路由层提前 400，领域层再校验一次（纵深）。

**模块解析替换**：`path.join(pluginsDir, "node_modules", spec)` → `createRequire(plugins/package.json).resolve()`。旧写法对 `@demo/app@1.2.3` 会拼出不存在的目录，且 `..` 可逃逸后被执行。tarball 形态包名未知，改为「安装前后依赖集合 diff」精确反查新增包。

**权限模型 v1（对齐路线图 §2 P1）**：

- 契约：`AppManifest.permissions`（申请）+ `AppServerContract.toolPermissions`（工具 → 权限映射）；
- 判定：`filterToolsByPermission` 纯函数 —— 未声明 `permissions` 的内置应用**不过滤**（零回归），声明了的走 **default deny**（未映射的工具一律丢弃）；
- **宿主零领域语义**：不猜工具属于哪个类别，映射由应用自己声明；
- 安装握手：声明了权限的包首次安装返回 **409 + 权限清单**（包已落地但不注册/不启用），前端展示中文说明（`describeAppPermission`）后带 `acknowledgedPermissions` 重试，确认结果留痕到 `apps.json`。

**真卸载**：`onUninstall → npm uninstall → appRegistry.unregister → 配置移除`。此前只做 `setEnabled(false)` + 配置过滤，磁盘上的第三方代码仍在可 import 路径上。

**真实服务端验证**（`next start`，非单测）：

| 场景 | 结果 |
|---|---|
| 默认未开启安装 | 403 + 可操作指引，`installPackage` 未触达 |
| 开启 + 无令牌 / 错令牌 | 401 / 401 |
| `../../etc/passwd` | 400「不允许包含 '..'」 |
| `lodash`（裸包名） | 400「形态非法」 |
| `DELETE /api/apps/demo` 后查磁盘 | `node_modules/@demo/app` **已摘除**；action → 404；配置与 plugins 依赖均清空 |

**新增测试**：app-sdk 权限纯函数 5 例 + 握手差集 3 例；`appSpec` 校验矩阵 8 例；`packageManager` 17 例（含"非法 spec 不触达 npm"）；安装路由闸门 5 例；门禁接线 3 例。

### 9.5 Phase 5 实施记录：宿主去领域化与跨平台探测

**问题**：`capabilityNegotiator.ts` 在宿主里写死了「设计类 / 禅道类 CLI 能力 → 可执行命令 → 中文修复指引」三件套。这违反底座原则「语义声明化」——平台层不应知道某个应用依赖哪个 CLI。

**改法**（契约先行，而非搬家）：

1. `@ginkgo/app-sdk` 新增 `PLATFORM_PROVIDED_CAPABILITIES`（平台自身提供的能力清单）与 `AppServerContract.healthCheck`；
2. 宿主 `checkAppHealth` 只剩两条规则：平台能力 → 就绪；非平台能力 → **只认应用声明的 `healthCheck`**，缺失时给出的是「请在应用侧实现健康检查」，而不是宿主编造的安装命令；
3. design 应用新增 `src/server/health.ts`（`checkDesignHealth`），缺失项与修复指引由应用给出，经组合根 `runtimeServers` 注入；
4. 第三方应用若在 `manifest.lifecycle.onHealthCheck` 实现，注册时适配到 `server.healthCheck`——运行时只有一条调用路径（避免两套机制并存）；
5. 健康检查结果按 **30s TTL 缓存**（此前每个 `GET /api/apps` 都会重新 spawn 外部命令）。

**为什么 healthCheck 不放在 manifest**：manifest 会被客户端组件链引用，而 CLI 探测依赖 `node:child_process`；放进 manifest 会把 Node 内置模块拖进浏览器包。服务端入口才是它的归属。

**跨平台修复**（同一文件族）：
- `resolveBinExecutable`：Windows 下 npm 生成的是 `foo.cmd`（部分为 `.exe`），原实现只找无后缀文件必然 miss —— 改为按平台枚举候选名；
- `getEnhancedEnv`：`PATH` 拼接改用 `path.delimiter`（Windows 是 `;`）；
- 新增 `probeCliAvailable`：ENOENT = 未安装，其它错误 = 存在但 `--version` 失败（仍算已安装），避免把「能跑但返回非 0」误判为缺失。

**验证**：

| 场景 | 结果 |
|---|---|
| 本机已装 `claude-design@0.1.2` / `claude-design-system@0.2.1` | design `ready`；analytics/general 不受影响 |
| 模拟缺失（`HOME=/tmp/fakehome` + 剔除 npm-global PATH） | design `missing_deps` + `["cli:claude-design","cli:claude-design-system"]` + 应用自带的 `npm install -g …` 指引 |
| 宿主源码领域关键词 | `grep claude_design/claude-design/zentao src/**` → **0 命中**（含注释，CI 守卫可直接用） |
| 缓存 | 单测断言连续两次调用只探测一次 |

**新增测试**：`capabilityNegotiator` 重写 7 例（平台能力就绪 / 无钩子降级且不含安装命令 / 钩子优先 / 钩子抛错降级 / 缓存 / 清缓存 / 内置 design 形态）；design `health.test.ts` 3 例。

### 9.6 Phase 6 实施记录：客户端与服务端事实来源对齐

**根因**：客户端的 `appRegistry` 是**打包期常量**，服务端启停应用不会改变它。原实现用一个 `appsVersion` 计数器 + `void appsVersion` 去"刷新"它——没有任何数据可刷新，memo 重算结果恒等，是一段看起来在工作、实际永远不生效的死状态。

**改法**：

1. 新增 `useEnabledApps`：从 `GET /api/apps` 拉取启用集合，`ids === null` 表示未加载（此时不过滤，避免首屏闪"应用列表为空"）；`refresh()` 返回最新集合供事件回调判定；
2. `ChatDashboard`：删除 `appsVersion`；`effectiveAppId` 直接派生（停用即回落默认应用），**不在 effect 里 setState**（会触发级联渲染，React 19 lint 规则直接报错）；回落后的持久化收敛到 `handleAppsChanged` 事件回调；
3. `ChatSidebar` / `AppSwitcher`：接收宿主传入的已启用列表，不再各自 `listApps()` 取全量；
4. `AppStoreModal`：
   - 取数逻辑收敛为唯一实现 `loadApps(signal)`，挂载 effect 用 `AbortController`（关闭弹窗即中止），手动刷新共用同一实现；
   - `isLoading` 由"挂载即加载"派生，避免 effect 内同步 `setState`；
   - 失败统一 `toast.error`（启停失败**不做乐观更新**，开关保持服务端状态）；
   - `AppStoreItem.health` 改为复用 SDK 的 `AppHealthCheckResult`（删掉本地重复定义）；
   - 删除 `isDegraded` 冗余变量与不可达三元分支；未注册应用展示"载入失败 + 具体原因"（用上 Phase 3 的 `loadError`）。

**真实浏览器验证**（`next start` + 共享浏览器，非单测）：

| 步骤 | 观察 |
|---|---|
| 打开应用切换器 | 3 个应用 + 应用中心入口徽标 `3` |
| 打开应用中心 | `已启用 3 / 3`，三张卡片均"能力就绪" |
| 在卡片上停用 design | 弹窗计数实时变 `已启用 2 / 3` |
| 关闭弹窗再开切换器 | design **消失**，徽标变 `2`——**无需刷新页面** |
| 查磁盘与 API | `analytics:true, general:true, design:false`；`activeCount: 2` |
| 重新启用 + 刷新 | 恢复 3 项 |

这组观察正是 O2 的验收：启用态以服务端为准，客户端不再自欺。

**新增测试**：`useEnabledApps` 3 例（首屏 null 语义 / refresh 返回集合 / 失败不误判为全停用）；`AppStoreModal` 新增 3 例（只发一次 GET / 启停失败提示且不乐观更新 / 未注册展示载入原因）。

### 9.7 Phase 7 实施记录：架构守卫、接入规范与全量验收

**架构守卫（把原则变成 CI 会跑的断言）**：新增 `src/lib/architecture-guards.test.ts`（5 个用例，随 `pnpm test` 在 CI 执行）：

| 守卫 | 断言 | 为什么用测试而非 eslint |
|---|---|---|
| 语义声明化 | 宿主 `src/**` 无 `claude_design` / `claude_data` 厂商词 | 跨文件约束，AST 规则成本高且易误报目录遍历一遍就够 |
| 能力协商器 | `capabilityNegotiator.ts` 无 `execFile/spawn/which` | 精确指向曾经的违规形态 |
| 存储根唯一 | `src/**` 无 `process.cwd() + data/config`（`storagePaths.ts` 豁免） | 失败信息直接给文件:行 |
| 依赖单向 | 6 个包目录无 `from "@/` | 同上 |
| 高危门禁 | `install/route.ts` 仍含 `GINKGO_ALLOW_APP_INSTALL` / `GINKGO_APP_INSTALL_TOKEN` 与 `!== "1"` | 防止"顺手改成默认开启" |

**文档同步**：

- `docs/app-integration-guide.md` 新增 §4.8 生命周期与健康检查、§4.9 权限声明与工具门禁、§4.10 打包与出口形态（含"不要整包 bundle"的实测理由）；§9 检查清单补两条。
- `docs/platform-ecosystem-roadmap.md`：P1 标注已落地并写明未落地项（工厂装配配置驱动）；P2 标注部分落地；新增 **P2.5 预打包发布**里程碑（三条硬约束 + `datasources` 是否继续内联的待决策 + `publishConfig` 语义待验证）。
- `docs/guide/environment-variables.md`：存储根章节（Phase 2）、应用安装章节（Phase 4）。
- `docs/.vitepress/config.mts`：注册本文档。
- `AGENTS.md`：常用命令补 `pnpm verify` / `pnpm storage:migrate`，并新增「架构守卫」小节。

**测试去脆化**：

- `cliBridge.test.ts` 不再断言 `vite` 被 hoist 到根目录（pnpm 结构一变就红），改为在临时目录构造 `node_modules/.bin` 现场；
- `registry.test.ts` 补「全局单例按打包种子注册三应用」；
- `appConfigServer.test.ts` 补「跨模块图仍复用同一份备份」；并修掉一处**真实测试缺陷**：用例间切换 `GINKGO_HOME` 却没重置存储根缓存，导致后续用例写进上一个用例的临时目录（暴露方式是我新增的备份计数断言）。

**全量验收（最终一次真实运行）**：

```bash
$ pnpm verify
lint ✅  typecheck ✅  test 176 files / 1491 passed ✅  build ✓ Compiled successfully ✅
```

全新克隆模拟（隐藏全部 3 个 `dist/`）：`typecheck` 0 错误、`build` 成功。

真实服务端验收（`next start` + 临时 `GINKGO_HOME` + 手工放置的 `@demo/app`）：

| 验收项 | 结果 |
|---|---|
| 启动引导注册第三方应用 | `[apps] 已注册 4 个应用（启用 4 个）` |
| 安装默认关闭 | `HTTP 403` |
| 停用后动作网关 | `HTTP 403 App disabled` |
| 重启进程 | demo 仍注册、`enabled=false`、动作仍 403 |
| 真卸载 | 磁盘包摘除 ✅ / 配置清除 ✅ / action `404` ✅ |
| 损坏配置 | `HTTP 200` + warning，坏文件未被覆盖，**备份 1 份**（多模块图 + 多次请求后） |


---

## 10. 最终状态

| 维度 | 结果 |
|---|---|
| 门禁 | `pnpm verify` = 0（lint / typecheck / 1491 tests / build） |
| 评审 26 项 | 25 项已修复；R8 经实测**纠正判断**（非缺陷，已在 tsup 配置固化原因） |
| 未做 | 预打包发布（P2.5 里程碑，含三条硬约束与两项待决策）；GitHub Pages 未启用（基础设施，非代码） |
| 提交状态 | **未提交**（项目红线：需用户明确指令） |

### 9.8 CI 复盘：前置验证的口径不够严（已修正）

推送后 CI 在 `Run TypeScript Check` 失败：

```
src/lib/apps/registry.ts(5,10): error TS2307:
  Cannot find module '../../../config/apps.json'
```

**根因**：`config/` 与 `data/` 是 gitignore 的运行期目录（含用户本地数据源、MCP 密钥），
而 `registry.ts` / `appConfigServer.ts` 把 `config/apps.json` 当作**模块** import。
开发机上文件存在所以本地全绿；全新克隆里根本不存在。

**为什么之前的"全新克隆模拟"没抓到**：我只隐藏了 `dist` 目录，没隐藏 `config/` 与
`data/`。这是一次**验证口径不足**，而不是运气问题——模拟必须把"gitignore 的目录"
全部隐藏，才是真正的全新克隆。

**修复**：

1. 种子移进代码：新增 `src/lib/apps/defaultAppsConfig.ts`（`DEFAULT_APPS_CONFIG` +
   `cloneDefaultAppsConfig()`），registry 单例与 `loadAppsConfig` 的首次运行兜底都改用它；
   读改写返回**副本**，避免调用方污染模块级种子；
2. 顺手修掉一个同类隐患：`workspaceResolver` 的 `DEFAULT_WORKSPACES_ROOT` 是模块级常量，
   在 `GINKGO_HOME` 晚于 import 生效时（测试、延迟引导）会算到错误的根——改为调用时解析；
3. `src/app/api/workspace/route.test.ts` 显式指定临时 `GINKGO_HOME`（此前隐式依赖仓库
   `data/`，全新克隆下会写到 `~/.ginkgo`）；
4. 新增架构守卫：**源码不得 import 被 gitignore 的运行期目录**（`config/`、`data/`），
   直接拦这一类问题复发。

**新的全新克隆模拟**（隐藏 `.next` + `config/` + `data/` + 全部 `dist`）：

```bash
$ pnpm verify
lint ✅  typecheck ✅  test 176 files / 1492 passed ✅  build ✓ Compiled successfully ✅
```

> 另：同一次推送的 `Deploy Docs` 失败与本改动无关——文档站构建成功，失败在
> `Setup Pages`（`Get Pages site failed`），属仓库未启用 GitHub Pages 的基础设施状态，
> 需在仓库设置中开启后才能通过。
