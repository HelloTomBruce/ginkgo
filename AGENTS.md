# 项目指南

## 主题维护

- **唯一颜色事实来源**：`src/app/globals.css`。所有颜色都是那里定义的 CSS 变量（oklch），经 `@theme inline` 桥接为 Tailwind 类。
- **禁止硬编码色板类**（`bg-slate-50`、`dark:text-blue-400` 等），eslint `no-restricted-syntax` 会直接报错。颜色一律用语义 token：`bg-card`、`text-foreground-subtle`、`bg-info-soft`、`text-success-fg` 等。
- **暗色模式跟随系统** `prefers-color-scheme`，无手动开关；暗色值在 globals.css 底部的暗色媒体查询块里覆写 token，组件侧不写 `dark:` 类。
- **图表颜色**用 `var(--chart-1..6)` / 语义 solid token，直接写进 SVG 属性或 inline style。
- 完整的 token 清单与「旧类 → token」映射表见 [docs/theme-tokens.md](docs/theme-tokens.md)。
- 新增颜色需求：先在 globals.css 加 token（亮暗双套），再在组件里引用。

## 常用命令

- `pnpm dev`：开发服务器（端口 3006）
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`：质量门禁
