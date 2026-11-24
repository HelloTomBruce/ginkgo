import type { AppManifest, AppClientContract } from "@ginkgo/app-sdk";
import { DesignStudioViewer } from "./client/DesignStudioViewer";

export const designManifest: AppManifest = {
  id: "design",
  name: "体验设计工坊",
  description: "交互式画板视觉设计、Design System Token 规范管理与前端合规代码审查",
  icon: "Palette",
  version: "1.0.0",
  category: "设计与创意",
  tags: ["UI/UX", "画板", "设计系统", "Tokens", "原型"],
  author: "Ginkgo Team",
};

export const designClient: AppClientContract = {
  welcomeMessage:
    "你好！我是体验设计工坊（Design Studio）助手。我可以为你创建交互式视觉画板（支持桌面/平板/移动端多视口）、建立与管理 Design System Token，并审计前端样式合规度。你想设计点什么？",
  presetQueries: [
    { text: "帮我设计一套 SaaS 云原生可观测平台的监控大屏，包含核心 KPI 与实时告警", category: "视觉画板" },
    { text: "为暗黑科技风设计一套完整的全局 Design Tokens（主色、辅助色、状态色与字阶）", category: "设计系统" },
    { text: "扫描当前前端工作区代码，审查是否存在硬编码色值并输出 Audit 报告", category: "代码审查" },
  ],
  hasWorkspace: true,
  workspaceView: "files",
  workspaceMount: true,
  workspaceTitle: "设计工作台",
  WorkspaceComponent: DesignStudioViewer,
  hasInputAccessory: false,
  defaultInteractionMode: "plan",
  sidebarTabs: [
    {
      key: "presets",
      label: "推荐",
      icon: "Compass",
      description: "设计灵感与常用场景",
    },
  ],
  toolRenderers: [
    {
      toolName: "edit_file",
      renderer: "diff",
      defaultOpen: true,
      title: "画板代码修改",
    },
    {
      toolName: "write_file",
      renderer: "diff",
      defaultOpen: true,
      title: "画板代码生成",
    },
  ],
  approvalRules: [
    {
      toolName: "write_file",
      riskLevel: "warning",
      title: "设计规范全局文件写入",
      condition: (args) => {
        const p = String(args.path || "");
        return p.includes("design-system.json") || p.includes("canvas.json");
      },
      defaultRejectFeedback: "用户拒绝直接覆盖全局设计系统或画板结构，请重新确认配置方案。",
    },
  ],
  messageExtensions: {
    planConfirm: {
      patterns: ["请确认", "是否按此方案", "确认方案", "设计方案已就绪", "认可上述设计规划"],
      label: "确认设计方案并开始构建",
      actionPrompt: "设计方案已确认，请严格按照上述规划执行落地并生成视觉画板与规范文件。",
    },
    toolSettledHint: "画板文件与服务调度已完成，大模型正在组织设计说明与呈现指引...",
  },
};
