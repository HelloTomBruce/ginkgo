/**
 * @ginkgolab/browser - 浏览器能力系统提示词指南
 */

import type { BrowserPermissionLevel } from "./types";

export function buildBrowserPromptSection(permissionLevel: BrowserPermissionLevel = "full"): string {
  const isReadOnly = permissionLevel === "readonly";

  return `
### 浏览器自动化能力规范（基于 Playwright 与智能语义定位）

你可以通过 \`browser_*\` 工具与网页进行交互。每个工具经过底层增强，具备意图定位、Shadow DOM 穿透、SPA 重锚定与失败自愈能力。

${
  isReadOnly
    ? `> [!IMPORTANT]
> **当前处于只读探查模式（Plan 阶段）**：
> 你仅拥有页面浏览、快照提取、元素查找、网络请求分析与截图能力。严禁执行点击、输入、表单填写或页面脚本执行等任何写操作副作用。若需执行变更操作，请先在方案中拆解规划，待方案确认进入执行阶段后再调用对应工具。`
    : `> [!NOTE]
> **当前处于全功能交互模式（Build/Execute 阶段）**：
> 你可以使用全套浏览器工具执行点击、输入、填表、拖拽、断言与自动化回归。`
}

#### 1. 核心工作流与定位优先原则
- **优先意图语义定位（what）**：对于点击或输入操作，优先使用 \`what\` 字段（如 \`browser_click { what: "登录" }\` 或 \`browser_click { what: "保存配置" }\`）。底层会自动计算语义匹配打分并注册引用，**一步完成定位与交互**，避免在全量快照和定位之间进行多轮低效往返。
- **页面快照与增量更新**：
  - 探查页面结构时，推荐使用 \`browser_snapshot { mode: "aria" }\` 获取可访问性树；
  - 若页面已发生滚动或小幅度变动，传入上次返回的 \`since: contentVersion\` 参数进行**增量比对**，大幅削减 token 消耗；
  - 也可以使用 \`browser_find { query: "用户名" }\` 精准锁定目标元素及其上下文链路。
- **搜索框与文本输入（browser_type）**：
  对于无明显文本标签的网页输入框（如百度、Google 等首页搜索框），优先使用通用属性定位（如 \`selector: "#kw"\`、\`selector: "input[name='wd']"\`、\`selector: "input[type='text']"\`），或先调用 \`browser_find { query: "搜索" }\` 或 \`browser_snapshot\` 定位 ref；若返回未命中提示与相近候选，请依据候选建议直接改用 selector 自愈重试。
- **智能表单填充**：面对包含多个输入框与下拉框的复杂表单，使用 \`browser_form_fill\` 批量传递键值对，无需逐个控件单独点击输入。
- **视觉反馈与截图协同（browser_screenshot）**：
  在调用 \`browser_open\` 打开目标网页后，或完成页面关键操作（如登录、表单提交、核心数据加载完成）后，**应主动调用一次 \`browser_screenshot\`**。
  所生成的页面高清截图会实时渲染至用户右侧多维工作台的「浏览器」视图中，为用户提供直观的所见即所得协同体验。

#### 2. 疑难交互与自愈机制
- **Shadow DOM 与 IFrame**：所有定位与点击工具已原生支持穿透 Open Shadow DOM 与跨域子 IFrame，无需手动切换上下文。
- **SPA 路由后软失效**：在前端路由切换后，旧元素引用会自动尝试重锚定。若遇到元素未反应，click 工具支持 \`effect: true\` 复核动静。
- **疑难元素看图定位**：遇到极其复杂的 Canvas 图表或无语义无类名的按钮，可调用 \`browser_screenshot { som: true }\` 开启视口标徽，多模态模型可通过数字标记直接点击（如 \`browser_click { mark: 12 }\`）。
`.trim();
}
