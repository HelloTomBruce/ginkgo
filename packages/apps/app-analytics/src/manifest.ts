import type { AppManifest, AppClientContract } from "@openui-analytics/app-sdk";
import { AnalysisCanvas } from "./client/AnalysisCanvas";
import { SourcePicker } from "./client/SourcePicker";

export const analyticsManifest: AppManifest = {
  id: "analytics",
  name: "智能数据分析师",
  description: "多源数据探查、指标计算、深度归因与敏捷可视化大屏",
  icon: "TrendingUp",
  version: "1.0.0",
  category: "数据智能",
  tags: ["BI", "数据看板", "SQL", "指标分析"],
  author: "OpenUI Team",
};

export const analyticsClient: AppClientContract = {
  welcomeMessage:
    "你好！我是智能数据分析师。我可以连接你的数据库与数据源，通过自然语言生成指标看板、归因漏斗与业务复盘报告。请问你想分析什么？",
  presetQueries: [
    { text: "分析近 30 天核心业务指标与异常波动", category: "探索分析" },
    { text: "按渠道复盘获客成本与转化漏斗", category: "获客转化" },
    { text: "分析迭代交付进度与团队负载分布", category: "研发效能" },
  ],
  // 声明该应用所需的外部插槽与其对应组件
  hasWorkspace: true,
  workspaceTitle: "数据分析画布",
  WorkspaceComponent: AnalysisCanvas,
  hasInputAccessory: true,
  InputAccessoryComponent: SourcePicker,
  defaultInteractionMode: "plan",
  sidebarTabs: [
    { key: "dashboards", label: "看板", icon: "LayoutGrid" },
    {
      key: "presets",
      label: "推荐",
      icon: "Compass",
      description: "一键带入分析模板（按方法卡生成）",
    },
  ],
  sidebarQuickActions: [{ key: "methodology", label: "分析方法论", icon: "BookOpen" }],
};
