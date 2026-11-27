import {
  promptExample,
  reportLayoutExample,
  focusLayoutExample,
  comparisonLayoutExample,
} from "./prompt";

/**
 * 布局范例动态选择器（Prompt Engineering：Dynamic Few-Shot）。
 *
 * 为什么不做全量注入：4 组布局范例每次全量注入会引发长度/风格偏置与相关性脱节——
 * 用户问「为什么 CAC 上升」时，注入 ReportLayout 复盘范例纯属 token 浪费，还会把
 * 交付物形态往错误布局上带。这里按用户问法关键词打分，动态注入最相关的 1 组。
 *
 * 选择策略（纯函数，无 IO）：
 * - 常驻 promptExample（通用混合看板基线，组件覆盖面最全）；
 * - 问法命中某布局关键词（取得分最高者）→ 追加该布局范例；
 * - 零命中/空输入 → 回落 reportLayoutExample（覆盖最常见的「生成看板/综合分析」类问法，
 *   同时该范例含 SpecChart 演示，是通用性最强的兜底）。
 */
const LAYOUT_KEYWORDS: ReadonlyArray<{
  id: string;
  example: string;
  keywords: readonly string[];
}> = [
  {
    // 周期性综合复盘 → ReportLayout 四区块报表
    id: "report",
    example: reportLayoutExample,
    keywords: [
      "复盘",
      "总结",
      "报告",
      "月度",
      "季度",
      "年度",
      "周报",
      "综述",
      "全面分析",
      "综合分析",
      "review",
      "report",
      "summary",
      "digest",
      "overview",
    ],
  },
  {
    // 单主题深钻归因 → FocusLayout（主图 + 侧栏洞察）
    id: "focus",
    example: focusLayoutExample,
    keywords: [
      "为什么",
      "归因",
      "原因",
      "下降",
      "上升",
      "波动",
      "骤增",
      "骤降",
      "异常",
      "诊断",
      "why",
      "root cause",
      "regression",
      "anomaly",
      "drop",
    ],
  },
  {
    // 两实体横向对比 → ComparisonLayout（双栏 + 结论）
    id: "comparison",
    example: comparisonLayoutExample,
    keywords: [
      "对比",
      "比较",
      "差异",
      "哪个更",
      "谁更",
      "对照",
      " vs ",
      "vs.",
      "versus",
      "compare",
      "comparison",
    ],
  },
];

/** 无命中时的兜底布局（ReportLayout：通用性最强，含 SpecChart 演示） */
const DEFAULT_LAYOUT_EXAMPLE = reportLayoutExample;

/**
 * 按用户最新问法动态选择布局范例（1 组布局 + 常驻通用基线）。
 * 返回值恒为 prompt.ts 导出常量的子集，受 promptExamples.test.ts schema 校验守护。
 */
export function selectLayoutExamples(userQueryHint?: string): string[] {
  const query = (userQueryHint ?? "").toLowerCase();
  let best: { example: string; score: number } | undefined;
  if (query.trim()) {
    for (const entry of LAYOUT_KEYWORDS) {
      const score = entry.keywords.reduce(
        (hits, kw) => (query.includes(kw) ? hits + 1 : hits),
        0
      );
      if (score > 0 && (!best || score > best.score)) {
        best = { example: entry.example, score };
      }
    }
  }
  return [promptExample, best?.example ?? DEFAULT_LAYOUT_EXAMPLE];
}
