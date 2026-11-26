import type { AppManifest } from "@ginkgo/app-sdk";

/**
 * 应用的纯元数据（**服务端安全**）：只含可声明数据，不 import 任何客户端组件。
 *
 * 为什么单独成文件：`manifest.ts` 里构建 `analyticsClient` 时会 import 客户端插槽
 * 组件（带 "use client"），整包 bundle 后根入口因而只能是客户端件。发布形态下
 * 服务端注册/协商需要 manifest，但不该被拖进客户端边界 —— 故提供 `./manifest` 出口。
 */
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
