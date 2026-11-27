# 包发布手册（Route B：发布依赖链）

> 状态：**已完成可发布改造并做过消费者冒烟**（2026-11）。首次公开发布前仍需你确认一处许可证选择（见 §6）。

## 1. 发布范围与顺序

统一使用 **`@ginkgolab`** scope。按依赖 DAG 分四层，**必须按层发布**（下层未发布时上层装不上）：

> **为什么不是 `@ginkgo`**：npm 的 scope 就是「组织/用户名」，全局唯一且不可抢。`ginkgo`
> 这个名字已被注册（`@ginkgo` 下没有任何已发布包，是组织名占用），因此改用 `@ginkgolab`。
> 若将来要换 scope，执行 `node scripts/set-scope.mjs @<新scope>` 一条命令即可全量改名
> （包名 + import + 文档），随后 `rm -rf .next && pnpm install && pnpm verify`。
> 已发布的包换 scope 需 deprecate 旧名 + 消费方改 import，代价高，故首次发布前定好。

```
第 1 层（无内部依赖）
  @ginkgolab/app-sdk      @ginkgolab/models      @ginkgolab/chart-spec      @ginkgolab/datasources
        │                    │                                          │
第 2 层 ├─ @ginkgolab/components（依赖 chart-spec）                        │
        └─ @ginkgolab/harness-core（依赖 models）                          │
第 3 层    @ginkgolab/sandbox（依赖 harness-core）                          │
           @ginkgolab/llm（依赖 app-sdk + harness-core）                    │
第 4 层    @ginkgolab/app-analytics（依赖 app-sdk / chart-spec / components / datasources）
           @ginkgolab/app-design（依赖 app-sdk / harness-core / sandbox）
```

`@ginkgolab/app-general` 仍在发布范围之外（`private: true`），需要发布时按同样模式改造。

## 2. 发布形态（每个包的约定）

| 项 | 约定 |
| --- | --- |
| 开发期出口 | `exports` → `./src/*.ts`（仓内不依赖 dist，全新克隆可直接 verify） |
| 发布期出口 | `publishConfig` → `./dist/*.js`（`pnpm pack` / `pnpm publish` 生效；**npm 不生效**） |
| 打包 | `tsup`，`format: esm`，`dts: true`，`platform: node`，`target: node22` |
| 外部依赖 | 全部 `external`（含 `@ginkgolab/*`）——不再内联 |
| 服务端/客户端边界 | 客户端入口加 `"use client"` banner；服务端入口（`./server`、`./manifest`）不加 |
| 根入口 | 两个应用包**不发布**根入口（混合了客户端组件）；服务端用 `./manifest` / `./server`，完整应用定义（含 client 契约数据与插槽组件）用 `./definition`，纯 UI 用 `./client` |
| 代码分割 | 多入口的服务端包开启 `splitting`：harness-core 的 `.js` 从 1226KB 降到 466KB（同一批依赖不再按入口重复内联） |
| engines | `node >= 22.12`（`@ginkgolab/datasources` 依赖 `node:sqlite`，Node 22 仍为 experimental） |

## 3. 发布：CI 为主路径（打 tag）

```bash
# 1) 统一升版本（10 个包必须同版本，tag 要和它一致）
pnpm pkg:bump patch          # 或 minor / major / 显式版本如 0.1.2
#    脚本会：断言当前版本一致 → 批量写入 → 回读校验
#    若上次批量写被中断（半新半旧），会拒绝并提示：
#      node scripts/bump-version.mjs <目标版本> --force
# 2) 本地先跑一遍完整预检
pnpm verify
pnpm -r --filter "./packages/**" run build
pnpm pkg:verify        # 打包校验：private/license/engines/出口文件是否存在
pnpm pkg:smoke         # 用本地 tarball 模拟真实消费者安装 + 导入

# 3) 打 tag 推送，触发 .github/workflows/publish.yml
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
```

CI 流水线（`.github/workflows/publish.yml`）依次执行：tag/版本一致性 → npm 凭证 → `pnpm verify`
→ 构建 → 打包校验 → 本地产物冒烟 → **分层发布** → 发布后从 registry 重新安装冒烟。

- **幂等**：`scripts/publish-packages.mjs` 会跳过已存在的版本，失败后直接重跑同一 tag 即可；
- **必需 secret**：仓库 Settings → Secrets → `NPM_TOKEN`（granular token，Read and write + `@ginkgolab` scope）；
- 想启用 npm provenance：给发布步骤的脚本加 `--provenance` 并声明 `permissions: id-token: write`。

## 3.1 手动发布（无 CI 时）

```bash
node scripts/publish-packages.mjs --dry-run   # 先看计划
node scripts/publish-packages.mjs             # 按四层真发（跳过已存在版本）
node scripts/smoke-published.mjs --version 0.1.1
```

## 3.2 发布前校验明细（脚本已覆盖）

```bash
# 1) 全量门禁
pnpm verify

# 2) 逐包构建 + 打包，检查发布期 manifest
pnpm --filter @ginkgolab/app-sdk build
pnpm --filter @ginkgolab/app-sdk pack --pack-destination /tmp/pk
tar -xzOf /tmp/pk/*.tgz package/package.json | jq '.main, .exports'

# 3) 消费者冒烟（唯一能证明"发出去可用"的环节）
mkdir -p /tmp/consumer && cd /tmp/consumer && npm init -y
npm i /tmp/pk/*.tgz react@19 react-dom@19
node -e 'await import("@ginkgolab/app-analytics/manifest"); await import("@ginkgolab/app-analytics/server")'
```

冒烟必须覆盖的 5 条：链上每个包可 import、各子路径出口存在、`./server` 可执行、根入口被
封禁（`ERR_PACKAGE_PATH_NOT_EXPORTED`）、`node:sqlite` 可加载。

## 4. 发布命令

```bash
# 第 1 层（可并行）
pnpm --filter @ginkgolab/app-sdk  publish --access public --no-git-checks
pnpm --filter @ginkgolab/models     publish --access public --no-git-checks
pnpm --filter @ginkgolab/chart-spec publish --access public --no-git-checks
pnpm --filter @ginkgolab/datasources publish --access public --no-git-checks

# 第 2 层
pnpm --filter @ginkgolab/components   publish --access public --no-git-checks
pnpm --filter @ginkgolab/harness-core publish --access public --no-git-checks

# 第 3 层
pnpm --filter @ginkgolab/sandbox publish --access public --no-git-checks
pnpm --filter @ginkgolab/llm     publish --access public --no-git-checks

# 第 4 层
pnpm --filter @ginkgolab/app-analytics publish --access public --no-git-checks
pnpm --filter @ginkgolab/app-design    publish --access public --no-git-checks
```

**必须用 `pnpm publish`，不能用 `npm publish`**：npm 不会重写 `workspace:*`（实测报
`EUNSUPPORTEDPROTOCOL`），也不应用 `publishConfig` 的 `main`/`exports` 覆盖。

## 5. 已知取舍

1. **`node:sqlite` 的产物修正**：esbuild 会把 `node:sqlite` 改写成裸 `"sqlite"`，`datasources`
   的 tsup 在 `onSuccess` 里做带**断言**的修正（找不到模式即抛错，不会静默产出坏包）。
   源码保持标准静态 import——改成 `createRequire` 会让仓库内 Next 构建报
   `Unsupported external type Url for commonjs reference`。
2. **根入口不发布**：应用包根入口因内联了客户端插槽组件，只能是客户端件；发布形态只给
   显式子路径，避免消费方在服务端误 import 触发 RSC 边界错误。
3. **`node:sqlite` 为实验特性**：Node 22 会打印 ExperimentalWarning，属预期。
4. **`./definition` 是客户端件**：它含插槽组件，带 `"use client"` banner。服务端只需要
   manifest/运行时能力时请用 `./manifest` / `./server`，不要 import `./definition`。
5. **版本必须整体推进**：10 个包共享同一版本号，`release-version.mjs` 会强制校验；
   将来接 changesets 后可改为独立版本，但需同步调整该脚本与流水线。

## 6. 许可证：MIT（已落地）

仓库根与 10 个发布包目录各自带一份 `LICENSE`（MIT，`Copyright (c) 2026 Ginkgo contributors`），
各包 `license` 字段为 `"MIT"`，README 末尾有授权说明段。

- tarball 内含 `LICENSE`（npm/pnpm 会自动纳入包目录内的 LICENSE，无需写进 `files` 白名单）；
- 如需更换著作权主体或年份，改根 `LICENSE` 后同步到 10 个包目录（`cp LICENSE <pkg>/`）；
- MIT 要求"在软件的所有副本中包含版权声明与许可声明"——包内带 `LICENSE` 正是为此。

## 7. 发布后

- 干净环境 `npm i @ginkgolab/app-analytics` 复跑 §3 的冒烟；
- 版本不可回收：只能 `npm deprecate` 或 24h 内 unpublish，故 §3 不可跳；
- 后续版本建议引入 changesets 做多包版本协同。

## 8. 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `ERR_PNPM_OTP_NON_INTERACTIVE` / `EOTP` | 账号启用了 auth-and-writes 两步验证，CI 无法交互输入 OTP | 换成带 **Bypass 2FA** 的 Granular Access Token 作为 `NPM_TOKEN`（见下） |
| `EOTP` 只在本地出现 | 同一次发布会话 OTP 超时 | 连续发布时可复用同一 OTP（约 30s 窗口）或改用 bypass token |
| `EPUBLISHCONFLICT` / 版本已存在 | 重跑同一 tag | 脚本会跳过已存在版本，直接重跑即可 |
| 发布后 `npm i` 报 `ETARGET`/`E404` | registry 传播延迟（秒级） | 等 1–2 分钟重试；流水线里的"发布后冒烟"会自动重装验证 |
| `private: true` 拒绝发布 | 漏删 private 字段 | `pnpm pkg:verify` 会提前拦住 |

### 2FA 与 CI 发布

npm 账号开了 auth-and-writes 后，"人肉发布"没问题，但 **CI 无法输入 OTP**。两种正解：

1. **Bypass 2FA 的 Granular Token**（推荐，改动最小）
   npmjs.com → Access Tokens → Granular Access Token → Read and write + `@ginkgolab` scope
   → **勾选 "Bypass two-factor authentication"** → 替换仓库 secret `NPM_TOKEN`。
2. **Trusted Publishing（OIDC，免 token）**
   在 npm 包设置里绑定 GitHub 仓库与 workflow，CI 用 `id-token: write` 直接发布，
   无需任何 secret。需要较新 npm CLI，且要逐包（或逐组织）配置，适合包数量稳定后再迁移。
