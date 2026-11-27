# 新应用接入质量准入清单

所有新应用（`packages/apps/*`）接入或架构评审时，必须满足以下七道质量门禁。完整范式见 [应用接入规范](/app-integration-guide)。

## 准入清单

- [ ] **1. 交付物中心（WorkspaceView）**
      右侧必须有专属的领域交付物工作台（如数据看板、代码树/Git/终端、架构拓扑等），拒绝纯单栏聊天。

- [ ] **2. 规划与执行断层隔离（Plan-first）**
      实现 `Plan` 与 `Build/Execute` 模式状态隔离；规划期权限档自动收敛为只读，明确用户确认信号。

- [ ] **3. 人机审批与高危拦截（HITL）**
      对具有副作用或高风险的动作（写入文件、执行 shell 命令、修改配置、写库等）声明 `approvalRules`，挂起并渲染 `ApprovalCard`。

- [ ] **4. 真实环境感知（Workspace as Ground Truth）**
      严禁模型凭记忆空想；通过原子工具实时从沙箱文件系统、Git 或数据源感知真实状态，动态修剪上下文防注意力涣散。

- [ ] **5. 工具闭环与自愈指导**
      工具保持高内聚原子化；执行报错返回必须具备建设性指引（带自愈线索），赋能智能体自主修复。

- [ ] **6. 架构单向依赖与语义规范**
      禁止应用逆向穿透宿主（不配 `@/*` 别名）；颜色与主题 100% 消费 CSS 语义 Token，严禁硬编码色板类。

- [ ] **7. 契约声明与可发布性**
      权限：需要数据/沙箱/命令能力时成对声明 `manifest.permissions` 与 `server.toolPermissions`——
      宿主按映射做 default deny 门禁，未声明的工具不会被挂载。
      外部依赖：CLI/服务类依赖由 `server.healthCheck` 自治探测（宿主不猜你的命令名）。
      发布：出口按 `./manifest` / `./server` / `./definition` / `./client` 拆分，不暴露混合根入口；
      `pnpm pkg:verify` + `pnpm pkg:smoke` 全过才可发版（详见 [包发布手册](/package-publishing)）。

## 内置应用对照

| 应用 | 交付物中心 | Plan-first | HITL | 说明 |
| --- | :-: | :-: | :-: | --- |
| app-analytics | ✅ 看板工作台 | ✅ | ✅ | 深度应用全范式参考实现 |
| app-design | ✅ 画板/Token 大盘 | ✅ | ✅ | 体验设计工坊 |
| app-general | ✅ ArtifactViewer | ✅ | ✅ | 通用助手最小范式 |

新增应用时，建议从与领域最接近的内置应用复制骨架再替换领域语义（prompt / 工具 / 交付物 / 插槽组件）。
