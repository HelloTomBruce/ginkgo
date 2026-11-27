# @ginkgolab/app-design

**体验设计工坊（Ginkgo Design Studio）**：基于 `claude-design`、`claude-design-system` 与 `claude-data` CLI 打造的专业 UI/UX 体验设计、响应式多画板视觉原型、Design Tokens 规范管理与代码合规审计应用。

## 核心能力

1. **交互式视觉画板 (Claude Design)**
   - 自动规划与构建符合标准规范的 `project/canvas.json` 与 `project/*.dc.html`；
   - 本地启动轻量预览服务，并在右侧多维工作台以嵌入式 iframe 呈现；
   - 支持桌面端 (100% / 1440px)、平板端 (768px)、手机端 (390px) 视口无缝切换。

2. **设计系统与 Token 治理 (Claude Design System)**
   - 建立与查看品牌全局色盘、字阶规范与基础组件；
   - 一键执行 `claude-design-system audit` 扫描前端代码，严禁硬编码色值。

3. **双栏人机协作与模式隔离 (HITL)**
   - **Plan 规划模式**：梳理信息架构与视觉风格，未获用户确认前禁止写操作；
   - **Build 执行模式**：落地生成画板代码并调用静态 check 检查；
   - **操作审批 (ApprovalCard)**：修改全局设计系统文件或覆写已有画板触发风险审批。


## License

MIT © 2026 Ginkgo contributors — 完整条款见包内 `LICENSE`（或仓库根 `LICENSE`）。
