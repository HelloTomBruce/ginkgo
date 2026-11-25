import { defineConfig } from "vitepress";

/**
 * Ginkgo 文档站配置（GitHub Pages 项目页：https://hellotombruce.github.io/ginkgo/）
 * 约定式站点根为 docs/，构建产物输出至 docs/.vitepress/dist（由 deploy-pages.yml 发布）。
 */
export default defineConfig({
  title: "Ginkgo",
  description:
    "Ginkgo 智能体应用平台：统一对话宿主 + 可插拔应用体系 + 平台级 Agent 运行底座",
  lang: "zh-CN",
  // GitHub Pages 项目页必须以仓库名作为 base
  base: "/ginkgo/",
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/ginkgo/logo.svg" }],
    ["meta", { name: "theme-color", content: "#6750a4" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Ginkgo",

    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "架构", link: "/guide/architecture" },
      {
        text: "深度文档",
        items: [
          { text: "应用接入规范", link: "/app-integration-guide" },
          { text: "平台生态路线图", link: "/platform-ecosystem-roadmap" },
          { text: "主题 Token 规范", link: "/theme-tokens" },
          { text: "LLM Harness 加固方案", link: "/llm-harness-hardening-plan" },
          {
            text: "LLM Harness 成熟度计划 v2",
            link: "/llm-harness-maturity-plan-v2",
          },
          { text: "LLM Harness 多实例部署", link: "/llm-harness-multi-instance" },
        ],
      },
      {
        text: "仓库",
        link: "https://github.com/HelloTomBruce/ginkgo",
      },
    ],

    sidebar: [
      {
        text: "指南",
        items: [
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "底座架构", link: "/guide/architecture" },
          { text: "五条底座原则", link: "/guide/principles" },
          { text: "环境变量", link: "/guide/environment-variables" },
          { text: "新应用接入质量准入清单", link: "/guide/quality-checklist" },
        ],
      },
      {
        text: "生态与集成",
        items: [
          { text: "应用接入规范", link: "/app-integration-guide" },
          { text: "平台生态路线图", link: "/platform-ecosystem-roadmap" },
        ],
      },
      {
        text: "设计规范",
        items: [{ text: "主题 Token 规范", link: "/theme-tokens" }],
      },
      {
        text: "LLM Harness",
        items: [
          { text: "加固方案", link: "/llm-harness-hardening-plan" },
          { text: "成熟度计划 v2", link: "/llm-harness-maturity-plan-v2" },
          { text: "多实例部署", link: "/llm-harness-multi-instance" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/HelloTomBruce/ginkgo" },
    ],

    editLink: {
      pattern: "https://github.com/HelloTomBruce/ginkgo/edit/main/docs/:path",
      text: "在 GitHub 上编辑此页",
    },

    outline: { level: [2, 3], label: "本页目录" },
    docFooter: { prev: "上一页", next: "下一页" },
    lastUpdatedText: "最后更新",
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题切换",

    footer: {
      message: "Ginkgo 智能体应用平台 · 文档站由 VitePress 驱动",
      copyright: "Copyright © Ginkgo Contributors",
    },
  },
});
