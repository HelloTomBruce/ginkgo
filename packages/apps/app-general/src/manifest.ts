import type { AppManifest, AppClientContract } from "@ginkgo/app-sdk";
import { ArtifactViewer } from "./client/ArtifactViewer";

export const generalManifest: AppManifest = {
  id: "general",
  name: "通用智能助手",
  description: "多领域知识问答、方案撰写、代码审查与日常工作协同",
  icon: "Bot",
  version: "1.0.0",
  category: "通用助理",
  tags: ["对话", "助手", "通用", "代码"],
  author: "Ginkgo Team",
};

export const generalClient: AppClientContract = {
  welcomeMessage:
    "你好！我是通用智能助手。我可以协助你编写代码、撰写方案、解答技术与业务问题。有什么我可以帮你的？",
  presetQueries: [
    { text: "帮我审查并重构一段代码，提升可维护性", category: "代码工程" },
    { text: "撰写一份软件系统架构设计方案提纲", category: "方案写作" },
    { text: "解释分布式事务中 2PC 与 TCC 的核心差异", category: "技术问答" },
  ],
  // 声明通用助手的工作区插槽与产物组件
  hasWorkspace: true,
  // 工作区视图语义：文件产物工作台（canvas-only 不依赖钉选看板）
  workspaceView: "files",
  // 支持挂载本地文件夹为会话工作区（侧栏「选择文件夹」按钮）
  workspaceMount: true,
  workspaceTitle: "工作区产物",
  WorkspaceComponent: ArtifactViewer,
  hasInputAccessory: false,
  defaultInteractionMode: "plan",
  sidebarTabs: [
    {
      key: "presets",
      label: "推荐",
      icon: "Compass",
      description: "常用指令与探索场景",
    },
  ],
};
