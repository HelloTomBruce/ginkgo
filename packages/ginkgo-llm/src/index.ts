/**
 * @ginkgolab/llm
 * 领域中立的 LLM 编排装配包：streamText 生命周期、模型链韧性、流中继、
 * 预算熔断、上下文治理与多应用接缝（resolveAppPrompt / resolveAppTools /
 * deliverable / onTaskFinish）。
 * 底层执行、韧性、配额计量与状态图由通用底座 @ginkgolab/harness-core 驱动；
 * 应用领域逻辑（如数据分析的 prompt/方法卡/跨源）全部经接缝由应用包注入。
 */

// 业务主入口与上下文
export { createAnalyzeHandler } from "./handler";
export type {
  AnalyzeHandlerOptions,
  AnalyzeRequestBody,
  AppResolutionContext,
  AppSourceSummary,
  AuthContext,
  SessionContextMeta,
  SessionContextStore,
} from "./handler";

// 平台提示词设施（注入防御纪律段 + 中立兜底提示词）
export {
  untrustedDataSection,
  withPlatformGuardrails,
  getPlatformBasePrompt,
} from "./platformPrompt";
