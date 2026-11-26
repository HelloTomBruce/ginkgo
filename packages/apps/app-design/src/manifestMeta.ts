import type { AppManifest } from "@ginkgo/app-sdk";

/**
 * 应用的纯元数据（**服务端安全**）：只含可声明数据，不 import 任何客户端组件。
 * 见 analytics 同名文件的说明；发布形态下服务端经 `./manifest` 出口读取。
 */
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
