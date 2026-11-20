/**
 * @openui-analytics/llm
 * 针对 OpenUI 业务特化的分析 Agent 装配包。
 * 底层执行、流中继、配额计量、状态图与中间件管道由通用底座 @openui-analytics/harness-core 驱动。
 */

// 业务主入口与上下文
export { createAnalyzeHandler } from "./handler";
export type {
  AnalyzeHandlerOptions,
  AnalyzeRequestBody,
  AuthContext,
  SessionContextMeta,
  SessionContextStore,
} from "./handler";

// 跨源映射注册表
export {
  resolveCrossSourcePairs,
  CrossSourceRegistry,
  defaultCrossSourceRegistry,
} from "./crossSourceMap";
export type {
  CrossSourcePair,
  CrossSourceLink,
  MappingEntry,
} from "./crossSourceMap";

// OpenUI 领域特化校验器（含语言 AST 规则）
export { OpenUIDslValidator } from "./guardrails/openuiDslValidator";
