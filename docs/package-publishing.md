# 包发布手册（Route B：发布依赖链）

> 状态：**已完成可发布改造并做过消费者冒烟**（2026-11）。首次公开发布前仍需你确认一处许可证选择（见 §6）。

## 1. 发布范围与顺序

统一使用 `@ginkgo` scope（原 `@ginkgo-apps/*` 已收敛为 `@ginkgo/app-*`）。按依赖 DAG 分四层，**必须按层发布**（下层未发布时上层装不上）：

```
第 1 层（无内部依赖）
  @ginkgo/app-sdk      @ginkgo/models      @ginkgo/chart-spec      @ginkgo/datasources
        │                    │                                          │
第 2 层 ├─ @ginkgo/components（依赖 chart-spec）                        │
        └─ @ginkgo/harness-core（依赖 models）                          │
第 3 层    @ginkgo/sandbox（依赖 harness-core）                          │
           @ginkgo/llm（依赖 app-sdk + harness-core）                    │
第 4 层    @ginkgo/app-analytics（依赖 app-sdk / chart-spec / components / datasources）
           @ginkgo/app-design（依赖 app-sdk / harness-core / sandbox）
```

`@ginkgo/app-general` 仍在发布范围之外（`private: true`），需要发布时按同样模式改造。

## 2. 发布形态（每个包的约定）

| 项 | 约定 |
| --- | --- |
| 开发期出口 | `exports` → `./src/*.ts`（仓内不依赖 dist，全新克隆可直接 verify） |
| 发布期出口 | `publishConfig` → `./dist/*.js`（`pnpm pack` / `pnpm publish` 生效；**npm 不生效**） |
| 打包 | `tsup`，`format: esm`，`dts: true`，`platform: node`，`target: node22` |
| 外部依赖 | 全部 `external`（含 `@ginkgo/*`）——不再内联 |
| 服务端/客户端边界 | 客户端入口加 `"use client"` banner；服务端入口（`./server`、`./manifest`）不加 |
| 根入口 | 两个应用包**不发布**根入口（混合了客户端组件）；服务端用 `./manifest` / `./server`，UI 用 `./client` |
| engines | `node >= 22.12`（`@ginkgo/datasources` 依赖 `node:sqlite`，Node 22 仍为 experimental） |

## 3. 发布前校验（每次必做）

```bash
# 1) 全量门禁
pnpm verify

# 2) 逐包构建 + 打包，检查发布期 manifest
pnpm --filter @ginkgo/app-sdk build
pnpm --filter @ginkgo/app-sdk pack --pack-destination /tmp/pk
tar -xzOf /tmp/pk/*.tgz package/package.json | jq '.main, .exports'

# 3) 消费者冒烟（唯一能证明"发出去可用"的环节）
mkdir -p /tmp/consumer && cd /tmp/consumer && npm init -y
npm i /tmp/pk/*.tgz react@19 react-dom@19
node -e 'await import("@ginkgo/app-analytics/manifest"); await import("@ginkgo/app-analytics/server")'
```

冒烟必须覆盖的 5 条：链上每个包可 import、各子路径出口存在、`./server` 可执行、根入口被
封禁（`ERR_PACKAGE_PATH_NOT_EXPORTED`）、`node:sqlite` 可加载。

## 4. 发布命令

```bash
# 第 1 层（可并行）
pnpm --filter @ginkgo/app-sdk  publish --access public --no-git-checks
pnpm --filter @ginkgo/models     publish --access public --no-git-checks
pnpm --filter @ginkgo/chart-spec publish --access public --no-git-checks
pnpm --filter @ginkgo/datasources publish --access public --no-git-checks

# 第 2 层
pnpm --filter @ginkgo/components   publish --access public --no-git-checks
pnpm --filter @ginkgo/harness-core publish --access public --no-git-checks

# 第 3 层
pnpm --filter @ginkgo/sandbox publish --access public --no-git-checks
pnpm --filter @ginkgo/llm     publish --access public --no-git-checks

# 第 4 层
pnpm --filter @ginkgo/app-analytics publish --access public --no-git-checks
pnpm --filter @ginkgo/app-design    publish --access public --no-git-checks
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

## 6. 许可证：MIT（已落地）

仓库根与 10 个发布包目录各自带一份 `LICENSE`（MIT，`Copyright (c) 2026 Ginkgo contributors`），
各包 `license` 字段为 `"MIT"`，README 末尾有授权说明段。

- tarball 内含 `LICENSE`（npm/pnpm 会自动纳入包目录内的 LICENSE，无需写进 `files` 白名单）；
- 如需更换著作权主体或年份，改根 `LICENSE` 后同步到 10 个包目录（`cp LICENSE <pkg>/`）；
- MIT 要求"在软件的所有副本中包含版权声明与许可声明"——包内带 `LICENSE` 正是为此。

## 7. 发布后

- 干净环境 `npm i @ginkgo/app-analytics` 复跑 §3 的冒烟；
- 版本不可回收：只能 `npm deprecate` 或 24h 内 unpublish，故 §3 不可跳；
- 后续版本建议引入 changesets 做多包版本协同。
