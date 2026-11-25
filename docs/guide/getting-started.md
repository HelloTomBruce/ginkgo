# 快速开始

## 环境要求

- **Node.js** ≥ 20（推荐 22+）
- **pnpm** ≥ 10
- 一个 LLM Provider 的 API Key（DeepSeek / OpenAI / Anthropic / 智谱 / Kimi 等 20+ 预设任选）

## 安装与启动

```bash
git clone git@github.com:HelloTomBruce/ginkgo.git
cd ginkgo
pnpm install
pnpm dev        # http://localhost:3006
```

打开页面后，点击右上角 **「设置」**：

1. 选择一个内置 Provider 预设（或新增自定义端点）；
2. 填入 API Key（可用 **测试连接** 探针一键验证连通性）；
3. 选择默认模型，保存即可开始对话。

也可以通过环境变量预置凭据（见 [环境变量](./environment-variables)）。

## 内置应用

平台开箱自带三个标准应用，在侧边栏顶部切换：

| 应用 | 能力 |
| --- | --- |
| **数据分析（analytics）** | 自然语言提问，LLM 编排多路数据源取数，流式生成可交互看板（KPI 卡、漏斗、热力图、雷达图、预算模拟器等 24 种组件） |
| **体验设计（design）** | 多端响应式视觉画板、设计系统 Token 大盘与样式合规审计 |
| **通用助手（general）** | 沙箱原子工具（read/edit/write/bash）+ ArtifactViewer 产物工作台 |

新应用接入零宿主改动，见 [应用接入规范](/app-integration-guide)。

## 数据源配置

结构化数据源在 **「设置 → 数据源」** 中配置（或写入 `config/datasources.json`）：

- **dbType 四选**：postgres / mysql / sqlite / clickhouse，全部只读双保险（词法守卫 + 引擎级只读）；
- **GitLab**：页面设置中配置 MCP Endpoint 与 Token（存浏览器 localStorage）；
- **禅道**：依赖本机已登录的 `zentao` CLI（`zentao mcp --read-only`），无需额外配置；
- **文件**：CSV / Excel 拖入即转 DuckDB 查询。

跨源联合分析由 `config/cross-source-map.json` 的 `mappings` 驱动——映射存在且双侧源激活时，跨源工具、提示词规则与欢迎语宣称三处联动开启。

## 常用命令

```bash
pnpm dev          # 开发服务器（端口 3006）
pnpm lint         # ESLint（含主题 token 护栏）
pnpm typecheck    # TypeScript 类型检查
pnpm test         # Vitest 全量测试
pnpm build        # 生产构建
pnpm docs:dev     # 本文档站本地预览
```

## 下一步

- [底座架构](./architecture) —— 理解 L0–L4 分层与依赖方向
- [五条底座原则](./principles) —— 裁决一切新代码的设计宪法
- [应用接入规范](/app-integration-guide) —— 开发你自己的第一个应用包
