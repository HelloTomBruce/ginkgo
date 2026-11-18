/**
 * @openui-analytics/llm 统一入口。
 * prompt/serverLibrary 为包内部件，不对外导出；
 * crossSourceMap 仅导出配对解析（/api/datasources 用它向客户端
 * 暴露「跨源能力是否成立」的 features 标志，配置细节不出包）。
 */
export { createAnalyzeHandler } from "./handler";
export type {
  AnalyzeHandlerOptions,
  AnalyzeRequestBody,
  AuthContext,
  SessionContextMeta,
  SessionContextStore,
} from "./handler";
export { resolveCrossSourcePairs } from "./crossSourceMap";
export type { CrossSourcePair } from "./crossSourceMap";
export { SessionStreamHub, defaultStreamHub } from "./streamHub";
export type { SessionStreamTask } from "./streamHub";
export {
  createReasoningFetch,
  createReasoningContentTransformStream,
} from "./reasoningStream";
