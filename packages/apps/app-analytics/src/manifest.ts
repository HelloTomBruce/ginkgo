import type { AppManifest, AppClientContract } from "@ginkgo/app-sdk";
import { AnalysisCanvas } from "./client/AnalysisCanvas";
import { SourcePicker } from "./client/SourcePicker";
import { resolveMethodologyPresets } from "./client/methodologyPresets";
import { MethodologyModal } from "./client/MethodologyModal";
import { ComponentCatalogModal } from "./client/ComponentCatalogModal";
import { CrossSourceSettings } from "./client/CrossSourceSettings";

export const analyticsManifest: AppManifest = {
  id: "analytics",
  name: "智能数据分析师",
  description: "多源数据探查、指标计算、深度归因与敏捷可视化大屏",
  icon: "TrendingUp",
  version: "1.0.0",
  category: "数据智能",
  tags: ["BI", "数据看板", "SQL", "指标分析"],
  author: "Ginkgo Team",
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
  workspaceView: "canvas",
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
  sidebarQuickActions: [
    {
      key: "methodology",
      label: "分析方法论",
      icon: "BookOpen",
      // 应用自治弹层：宿主统一管理 open 状态渲染（快捷动作组件插槽）
      Component: MethodologyModal,
    },
    {
      key: "components",
      label: "可视化组件",
      icon: "LayoutGrid",
      // 看板组件目录（本应用 DSL 组件集 + 演示样例）
      Component: ComponentCatalogModal,
    },
  ],
  // 消息内看板工具条：三项操作全开（general 等其他应用未声明则不渲染操作按钮）
  dashboardToolbar: { title: "动态看板", pin: true, favorite: true, exportPdf: true },
  // 设置中心应用分区：跨源映射为本应用领域自有配置（平台级数据源/模型配置归宿主）
  settingsSections: [
    {
      key: "cross-source",
      label: "跨源映射",
      icon: "Link2",
      Component: CrossSourceSettings,
    },
  ],
  // 消息区扩展：patterns 与 prompt.ts 对模型输出话术的硬性要求同源维护
  messageExtensions: {
    planConfirm: {
      patterns: ["请确认以下分析方案", "澄清点说明", "分析思路确认"],
      label: "按此思路开始分析",
      actionPrompt:
        "请按上述已确认的分析思路开始执行，产出完整的分析报告与看板。",
    },
    completion: {
      title: "数据取数与分析计算已全部完成",
      buttonLabel: "立即生成报告与看板",
      actionPrompt:
        "数据取数与计算已全部完成。请立即基于上述结果，输出完整的 Markdown 深度分析报告以及 ```ginkgo 可视化动态看板代码块。",
    },
    toolSettledHint: "数据查询已完成，大模型正在组织分析洞察并构建视觉看板...",
  },
  // 推荐列表 = 方法卡合并集（运行时解析插槽）
  resolvePresetQueries: resolveMethodologyPresets,
};
