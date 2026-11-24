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
  // 声明工具的高级通用展示渲染器（L2 @ginkgo/components 驱动）
  toolRenderers: [
    {
      toolName: "edit_file",
      renderer: "diff",
      defaultOpen: true,
      title: "代码变更审阅",
    },
    {
      toolName: "write_file",
      renderer: "diff",
      defaultOpen: true,
      title: "文件变更",
    },
    {
      toolName: "run_command",
      renderer: "terminal",
      defaultOpen: false,
    },
  ],
  // 声明人机协同审批规则（Human-in-the-Loop）
  approvalRules: [
    {
      toolName: "run_command",
      riskLevel: "danger",
      title: "高危终端命令审批",
      condition: (args) => {
        const cmd = String(args.command || "");
        return /\brm\s+-[rf]{1,2}\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\b|\bkill\b/i.test(cmd);
      },
      defaultRejectFeedback: "用户拒绝执行该高危终端命令，请尝试使用更安全或非破坏性的替代方案。",
    },
  ],
  // 消息流扩展：Plan 规划模式快捷确认与工具执行过渡
  messageExtensions: {
    planConfirm: {
      patterns: ["请确认", "是否按此方案", "确认方案", "分步实施计划", "若认可上述方案"],
      label: "确认方案并开始构建",
      actionPrompt: "方案已确认，请严格按照上述规划执行落地构建代码与产物。",
    },
    toolSettledHint: "沙箱文件读写与命令执行已完成，大模型正在组织代码与方案输出...",
  },
};
