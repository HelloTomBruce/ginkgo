/**
 * Certified Queries 语义层与口径治理类型定义
 */

export interface CertifiedQueryParam {
  name: string;
  type: "string" | "number" | "date" | "array";
  defaultValue?: unknown;
  description: string;
}

export interface CertifiedQuery {
  /** 唯一标识，如 "cq_marketing_cac", "cq_monthly_net_revenue" */
  id: string;
  /** 绑定的数据源 ID（若为通用数仓/全源可用可为 "*"） */
  sourceId: string;
  /** 指标或查询标题 */
  title: string;
  /** 业务口径详细描述 */
  description: string;
  /** 业务计算公式说明，例如："净营收 = 支付总额 - 退款金额 - 渠道优惠券" */
  businessMetricFormula?: string;
  /** 标准 SQL / CTE 模版 */
  sqlTemplate: string;
  /** 允许的动态入参声明 */
  allowedParams?: CertifiedQueryParam[];
  /** 场景与业务域标签（用于语义路由召回） */
  tags: string[];
  /** 认证人或审计团队 */
  certifiedBy?: string;
  /** 认证时间戳 */
  certifiedAt?: number;
}

export type MatchConfidence = "exact" | "high" | "medium" | "low";

export interface CertifiedQueryMatch {
  query: CertifiedQuery;
  score: number;
  confidence: MatchConfidence;
  matchedTerms: string[];
}
