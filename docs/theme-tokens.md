# 主题 Token 体系与迁移映射表

本项目的所有颜色事实来源是 [`src/app/globals.css`](../src/app/globals.css)。
业务代码禁止出现 `bg-slate-*` / `text-blue-*` 这类具体色板类，一律使用下表 token 类。
暗色模式跟随系统 `prefers-color-scheme`（无手动开关），亮暗两套值都定义在 globals.css 中。

## 中性阶梯（对齐 slate 色阶）

| 旧写法（亮 / 暗） | token 类 | 说明 |
|---|---|---|
| `bg-slate-50 dark:bg-slate-950`（页面画布） | `bg-surface-page` | 应用底层画布 |
| `bg-white dark:bg-slate-900` | `bg-card` | 卡片/侧栏/弹窗 |
| `bg-slate-50 dark:bg-slate-950`（输入框/凹陷井） | `bg-surface-sunken` | 与 page 同值，语义区分 |
| `bg-white dark:bg-slate-950`（激活态页签） | `bg-surface-active` | 亮=白卡片，暗=slate-950（比 card 更沉一档） |
| `bg-slate-100 dark:bg-slate-800` / `hover:bg-slate-100 dark:hover:bg-slate-800` | `bg-muted` / `hover:bg-muted` | 浅填充、hover |
| `bg-slate-200 dark:bg-slate-700` | `bg-surface-raised` | 进度槽、分隔块 |
| `bg-slate-950 text-slate-100`（常暗面板） | `bg-surface-inverse text-surface-inverse-foreground` | DevTools 等固定深色区 |
| `border-slate-200 dark:border-slate-800` | `border-border` | 默认边框 |
| `border-slate-100 dark:border-slate-800` | `border-border-subtle` | 更弱分隔 |
| `border-slate-300 dark:border-slate-700` | `border-border-strong` | 更强边框/虚线框 |
| `text-slate-900 dark:text-slate-100` | `text-foreground` | 主文字 |
| `text-slate-800 dark:text-slate-200` | `text-foreground-strong` | 次级强调 |
| `text-slate-700/600 dark:text-slate-300` | `text-foreground-subtle` | 次级文字 |
| `text-slate-500 dark:text-slate-400` | `text-muted-foreground` | 辅助文字 |
| `text-slate-400 dark:text-slate-500/600` | `text-foreground-faint` | 占位/图标/时间戳 |
| `focus:ring-blue-500` / `focus-within:ring-blue-500` | `focus:ring-ring` | 焦点环校准为沉稳石墨微光环 |
| `bg-blue-600 hover:bg-blue-700 text-white`（主按钮） | `bg-primary hover:bg-primary/90 text-primary-foreground` | `--primary` 已升级为黑曜石近黑（暗色为柔白），顶级工程工具质感 |

## 状态/强调色

每个色相提供 10 档（以 `info` 为例，其余替换前缀即可）：

| 档位 | 类名示例 | 对应旧写法 |
|---|---|---|
| 浅底 | `bg-info-soft` | `bg-blue-50 dark:bg-blue-950/40`（`/30–/50` 归一到此） |
| 浅底 hover | `hover:bg-info-soft-hover` | `hover:bg-blue-50 dark:hover:bg-blue-950/50`（`/60–/70` 归一到此） |
| 浅底强 | `bg-info-soft-strong` | `bg-blue-100 dark:bg-blue-950/90`（Toast、徽章） |
| 边框 | `border-info-border` | `border-blue-200 dark:border-blue-800` |
| 边框强 | `border-info-border-strong` | `border-blue-300/400 dark:border-blue-700` |
| 文字 | `text-info-fg` | `text-blue-600 dark:text-blue-400` |
| 文字强 | `text-info-fg-strong` | `text-blue-700 dark:text-blue-300` |
| 实心 | `bg-info-solid` | `bg-blue-600`（徽章/按钮底） |
| 实心 hover | `hover:bg-info-solid-hover` | `hover:bg-blue-700` |
| 实心文字 | `text-info-on-solid` | `text-white`（搭配实心底） |

色相前缀对照：

| 前缀 | 原色板 | 典型用途 |
|---|---|---|
| `info` | blue | 链接、激活态、主操作 |
| `success` | emerald | 成功、已连接、正向指标 |
| `warning` | amber | 警告、收藏星标 |
| `danger` | rose | 删除、错误 |
| `brand` | purple | 品牌辅助、AI 相关入口 |
| `indigo` / `sky` / `violet` | 同名色板 | 数据源类型徽章等区分色 |

## 竞技排行/梯队色阶（Rank Tiers）

用于排行榜、榜单、金银铜徽章与对比梯队，亮暗两套自适应：

| 梯队 | soft 浅底 | border 边框 | fg 文本 | solid 实体/进度条 |
|---|---|---|---|---|
| 第 1 名 / 金牌 (`rank-1`) | `bg-rank-1-soft` | `border-rank-1-border` | `text-rank-1-fg` | `bg-rank-1-solid` |
| 第 2 名 / 银牌 (`rank-2`) | `bg-rank-2-soft` | `border-rank-2-border` | `text-rank-2-fg` | `bg-rank-2-solid` |
| 第 3 名 / 铜牌 (`rank-3`) | `bg-rank-3-soft` | `border-rank-3-border` | `text-rank-3-fg` | `bg-rank-3-solid` |

## 图表色板

`--chart-1` ~ `--chart-6`（亮暗同值），图表组件通过 CSS 变量读取，禁止再硬编码十六进制。

## 归一化说明（迁移后有轻微视觉变化的点）

- slate 与 shadcn neutral 的细微色相差异已统一为 slate 系；
- 暗色 soft 底统一为 `950/40%`（原 `/30`–`/50` 混用）；
- `bg-*-50 dark:bg-*-950/90` 的 Toast 归一到 `*-soft-strong`（亮色底从 50 升为 100）；
- `text-blue-500` 归一到 `text-info-fg`（blue-600）；
- shadcn 基础件的 `--primary` 从近黑改为品牌蓝、`--ring` 从灰改为 blue-500，焦点态更醒目。

## 打印导出

打印时 `@media print` 内的 `:root` 重置把 token 整体拉回亮色，
不再需要针对 `dark:bg-slate-*` 类的逐条覆盖。
