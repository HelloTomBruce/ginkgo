# 平台生态路线图：能力包扩展与第三方应用分发

> 定位：本仓库从「自带两个应用的产品」演进为「OpenUI 智能体应用平台 + 应用生态」的架构路线。
> 上游文档：[应用接入规范](app-integration-guide.md)（单个应用如何接入）；本文回答**平台侧**
> 要长出哪些能力包、第三方应用如何分发安装。
> 状态：设计定稿（2026-11）；各阶段标注优先级与前置依赖，实施前逐阶段出实施方案。

## 0. 现状基线

平台化收敛已完成（commit `61803cd`）：

- 编排层 `@openui-analytics/llm` 领域中立，四接缝（`resolveAppPrompt` /
  `resolveAppTools` / `deliverable` / `onTaskFinish`）是应用领域逻辑的唯一注入口；
- `@openui-analytics/app-sdk` 承载插槽协议（manifest / 客户端插槽 / 服务端契约 /
  产物协议 / 交付物契约 / `defineApp`）；
- 平台服务六件套：编排、数据语义（datasources）、渲染（components）、方法论、
  工作区沙箱、产物协议；
- 应用注册：`src/lib/apps/registry.ts` **编译期静态 import**——这是分发演进的起点约束。

生态化的前提项（按优先级）：

1. **能力协商闭环（近期）**：`requiredCapabilities` 目前只有声明、没有校验降级链路
   （特性开关仅覆盖数据源的 `crossSource` 一个特性）——P1 动态注册的直接配套。
2. **per-app 工具门禁（近期）**：本地单机形态下第三方代码将直接进进程，鉴权缺席时
   它是唯一的补偿性安全边界（详见 §2 P1 权限模型）。
3. **鉴权多租户（WS-10 收口，优先级已降低→部署化前置项）**：`authenticate` 仍是
   匿名桩，sessions/dashboards/schema-cards 存储无租户维度。本地单机/可信环境
   形态下暂缓；当平台要部署到共享环境（多人使用、面向公网）时必须先行落地，
   届时 GET 探针与 `/api/usage` 需同步传入租户（handler 注释已标注）。

---

## 1. 能力包扩展路线

原则（全部沿用已验证的注入模式）：**协议在 app-sdk、实现在独立包、实例由宿主组合根
经 `createXxx(deps)` 工厂注入**；能力包不感知具体应用；应用声明
`requiredCapabilities`，宿主按可用性协商降级。

| # | 能力包 | 解决什么 | 优先级 | 现有锚点 |
| --- | --- | --- | --- | --- |
| ① | **openui-memory** 记忆/知识 | 跨会话记忆、用户偏好、轻量知识库（RAG）——general/客服/研究类应用共同刚需 | ★★★ | `sessions` 通道（pendingPlan 同模式扩展）；harness tokenizer 做记忆预算 |
| ② | **文档交付物**（components 扩展 + document-spec） | OpenUI Lang 目前是看板中心；补文档原语（章节/表格/导出）解锁第二类应用（app-sdk 注释已预留「文档写作包提供 DocumentEditor」） | ★★★ | `CATALOG_GROUPS` 单一注册源 + `serverLibrary` 同构扩展；产物协议 `type:"document"` 已预留 |
| ③ | **openui-scheduler** 定时任务/订阅 | 看板定时刷新、日报周报订阅推送；产物协议的放大器 | ★★ | `refreshArtifact` 已 compute-only 化，调度层只需定时调它；harness 遥测观测 |
| ④ | **openui-executor** 沙箱执行 | 受限代码执行（资源限额/超时/网络策略），devops/模拟器/数据科学类刚需 | ★★ | `workspaceResolver` 边界已有；general 的 `run_command` 是雏形，升级为 worker/vm 隔离 + 权限声明 |
| ⑤ | **文件理解**（openui-ingest 扩展） | PDF/Word/JSON 等非结构化入库 | ★★ | `fileStore.ingestFiles` 的 staging→原子替换管线直接复用 |
| ⑥ | **openui-share** 分享/导出 | 分享链接、PDF/图片导出、iframe embed——产物传播闭环 | ★ | `.openui.json` 快照已有；DashboardPreviewModal 只读渲染可复用 |
| ⑦ | **应用级配额**（harness-core 扩展） | appId 维度的计量/限额/计费——第三方上架后的商业化基础 | ★（随分发做） | `CostLedger.record` 增加 appId 字段，向下兼容 |

各能力包交付物统一为：包（协议类型 + 工厂 + 默认实现）+ app-sdk 契约扩展 +
factory 级测试 + 接入规范增量章节。

**与债务清偿的合并**：⑦ 与「能力协商闭环」合并实施即清掉 `requiredCapabilities`
声明无校验的旧债；④ 实施时顺带收敛 general `run_command` 的黑名单模型为声明式权限。

---

## 2. 第三方应用分发（三段演进 + 轻应用通道）

### P1 · 动态注册 + 配置驱动（近期 · 约 2-3 天 · 零新基建）

**目标**：安装一个应用 = 「装包 + 配置一行」，宿主代码零改动。

- `config/apps.json`：`{apps: [{package: "@openui-apps/devops", enabled: true, runtime?: {...}}]}`
  ——符合仓库「配置零硬编码」原则；
- `appRegistry` 启动时按配置 `await import(pkg)` 动态注册；`src/lib/apps/runtimeServers.ts`
  的工厂装配改为配置驱动（工厂包名 + 依赖映射进 config）；
- **能力协商闭环**：注册时校验 `requiredCapabilities` vs 平台 `features`，缺失→
  注册降级（应用可见但不可用，提示缺什么），而非运行时崩溃；
- **权限模型 v1（从 P2 提前）**：鉴权多租户降级后，这是第三方代码进进程的
  补偿性安全边界——manifest 声明 `permissions: ["datasources.read",
  "workspace.write", "mcp:gitlab"]`，宿主在 `resolveAppTools` 分发处执行
  per-app 工具白名单门禁（harness 洋葱切面 `composeToolInterceptors` 是现成挂点）。

### P2 · 应用目录 + 安装管理 + 权限模型（中期 · 约 1-2 周）

- **应用目录服务**：manifest 索引（名称/版本/截图/所需能力/权限声明）+ 目录 API +
  侧栏「应用市场」入口（复用 AppSwitcher 交互位）；
- **安装管理**：UI 触发安装（宿主执行包安装或 git 拉取）→ 启用/禁用/更新/卸载，
  状态落 `config/apps.json`；
- **权限模型 v2**：在 P1 的工具白名单之上补数据面粒度（源级/字段级脱敏）与
  权限审批 UX（安装时展示所需权限清单）；
- 应用级配额（⑦）本阶段落地。

### P3 · 运行时沙箱分发（远期 · 应用商店终态 · 前两段验证生态成立后再投入）

- **应用包格式规范**：`openui-app.tgz` = `manifest.json + client.js + server.js`
  （标准 ESM bundle）；
- **server 侧**：worker_threads / `node:vm` 隔离执行，能力以显式句柄注入
  （能力即对象，不给 `require`/`fs`）——Cloudflare Workers 模型；
- **client 侧**：iframe / ShadowRealm 渲染插槽组件，postMessage 桥接；
- **信任链**：包签名校验 + 版本锁定 + 目录审核状态；
- 收益：第三方应用不进宿主进程依赖树，真「下载即用」；代价：沙箱基建与调试体验。

### 超轻应用通道（与 P1 并行即可用）

多数「第三方接入」实际只是**工具接入**——MCP 是事实标准。宿主支持
「安装 MCP server 声明 + 应用皮肤」（manifest 引用 MCP 源 + 纯配置 prompt），
零包分发成本长出轻应用；与 AGENTS 数据源零硬编码原则完全同构。

---

## 3. 落地顺序与验证

```
阶段 4a（约 1 周）  ：动态注册/配置驱动(P1) + 能力协商闭环 + per-app 工具门禁 v1
                     —— 平台从「能跑」到「能装」（无鉴权前置）
阶段 4b（约 1.5 周）：记忆能力包(①) + 文档交付物(②) + 目录/安装管理(P2, 权限模型 v2)
                     —— 第一个真正面向第三方的能力面
阶段 4c（按需）    ：调度/沙箱执行/分享 ③④⑥ + P3 运行时分发
阶段 4d（部署化时）：鉴权多租户（WS-10 收口）——触发条件：多人共享/公网部署诉求出现
```

**验证策略**（延续本仓库模式）：

- 每个能力包：factory 级单元测试 + 接入规范增量章节；
- 新应用 **devops（研发效能）** 作为第一个「按规范接入的第三方视角应用」贯穿
  4a/4b——它同时消费 ④沙箱执行 与 ⑦配额，是规范与权限模型的实战试金石；
- 分发链路：P1 用本地目录模拟安装源做端到端测试（装→启→用→卸），P2 起补
  权限门禁的拒绝路径测试。

## 4. 与现有文档的关系

- [应用接入规范](app-integration-guide.md)：单个应用视角的协议事实来源；生态能力
  上线后在其 §4/§6 增量更新（新接缝字段 / 新产物类型）；
- `docs/llm-harness-maturity-plan-v2.md`：WS-8~13 多副本/计量基建的实施方案，
  本路线的 4d（鉴权，部署化触发）即其 WS-10 的最终收口；
- 根 README / AGENTS.md：随阶段实施同步更新平台描述。
