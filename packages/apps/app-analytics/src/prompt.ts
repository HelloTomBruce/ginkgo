import type { AppServerContext } from "@openui-analytics/app-sdk";

/**
 * 数据分析应用自治的系统提示词生成逻辑
 */
export function buildAnalyticsSystemPrompt(ctx: AppServerContext): string {
  const parts: string[] = [];

  parts.push(
    `你是一位资深的数据分析专家。擅长通过指标下钻、归因漏斗和对比分析发现业务问题，并用清晰直观的 OpenUI 图表与指标卡片输出洞察结论。`
  );

  if (ctx.schemaDigestText) {
    parts.push(`## 当前已连接的数据源结构\n${ctx.schemaDigestText}`);
  }

  if (ctx.methodologyText) {
    parts.push(`## 可用的数据分析方法论\n${ctx.methodologyText}`);
  }

  parts.push(`## 分析交付规范
1. 优先使用执行 SQL 或探查工具查询真实业务数据，禁止编造虚假数字。
2. 发现数据趋势与异常时，给出明确的归因判断与业务优化建议。
3. 当产出可视化结果时，使用 \`\`\`openui 代码块包裹声明式图表。`);

  return parts.join("\n\n");
}
