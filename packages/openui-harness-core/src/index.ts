/**
 * @openui-analytics/harness-core
 * 企业级通用 LLM Harness 执行与治理底座。
 * 领域无关、零业务硬编码、中间件驱动、具备自愈与状态图编排能力。
 */

// Core Entry
export { HarnessCore } from "./core";

// Configuration
export {
  HarnessConfigSchema,
  DEFAULT_HARNESS_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_GRAPH_CONFIG,
  DEFAULT_RESILIENCE_CONFIG,
  DEFAULT_GUARDRAILS_CONFIG,
  DEFAULT_FINOPS_CONFIG,
  DEFAULT_STREAM_CONFIG,
  DEFAULT_MCP_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  loadHarnessConfigFromEnv,
  resolveHarnessConfig,
  type HarnessConfig,
  type ResolvedHarnessConfig,
  type DeepPartial,
} from "./config";

// Pipeline
export {
  HarnessPipeline,
  type HarnessContext,
  type HarnessMiddleware,
  type MiddlewareFunction,
  type MiddlewareNext,
} from "./pipeline/pipeline";

export {
  createCredentialGuardMiddleware,
  createConcurrencyGateMiddleware,
  createTenantQuotaMiddleware,
  createAutoHealingMiddleware,
  type ConcurrencyGateOptions,
  type CredentialGuardOptions,
  type TenantQuotaOptions,
  type AutoHealingMiddlewareOptions,
} from "./pipeline/middlewares";

// Graph & Human-in-the-Loop
export {
  StateGraph,
  CompiledStateGraph,
  START,
  END,
  type StateGraphOptions,
  type RunGraphOptions,
  type BreakpointRule,
} from "./graph/stateGraph";

export {
  InMemoryCheckpointer,
  type Checkpointer,
} from "./graph/checkpointer";

export type {
  Checkpoint,
  NodeAction,
  ConditionalRouter,
  GraphExecutionResult,
} from "./graph/types";

// Guardrails
export {
  AutoHealingGuardrail,
  type StructureValidator,
  type ValidationResult,
  type AutoHealingOptions,
} from "./guardrails/autoHealing";

// Providers & Resilience
export {
  ModelCatalogRegistry,
  defaultModelCatalog,
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_CONTEXT_WINDOW,
  isReasoningModel,
  type ReasoningEffort,
  type ModelCatalog,
} from "./providers/registry";

export {
  buildLanguageModel,
  type ModelFactoryOptions,
  type ResilienceTelemetryHooks,
} from "./providers/factory";

export {
  createResilientFetch,
  resolveResiliencePolicy,
  classifyProviderError,
  isRetriableErrorClass,
  type ResiliencePolicy,
  type ResolvedResiliencePolicy,
  type ResolvedModelSpec,
  type ModelSpec,
  type ProviderErrorClass,
} from "./providers/resilience";

// FinOps
export {
  computeCostUsd,
  DEFAULT_QUOTA_WINDOW_MS,
  ModelPricingTable,
  InMemoryCostLedger,
  NdjsonCostLedger,
  RedisCostLedger,
  type CostLedger,
  type UsageRecord,
  type ModelPricing,
  type QuotaPolicy,
} from "./finops/costLedger";

// Stream Hub & Task Stores
export {
  SessionStreamHub,
  defaultStreamHub,
  DEFAULT_TENANT_ID,
  type SessionStreamHubOptions,
  type SessionStreamTask,
  type StreamSubscriber,
} from "./stream/streamHub";

export {
  InMemoryTaskStore,
  type TaskStore,
  type TaskSnapshot,
  type TaskStatus,
} from "./stream/taskStore";

export {
  FileTaskStore,
  PROCESS_RESTART_ERROR_MESSAGE,
  type FileTaskStoreOptions,
} from "./stream/fileTaskStore";

export {
  RedisTaskStore,
  type RedisTaskStoreOptions,
  type RedisLike,
} from "./stream/redisTaskStore";

// Telemetry & Observability
export {
  createConsoleSink,
  compositeSink,
  newRunId,
  jsonByteSize,
  type TelemetrySink,
  type HarnessEvent,
  type RunId,
  type AbortReason,
} from "./telemetry/telemetry";

export {
  createMetricsSink,
  type MetricsRegistry,
} from "./telemetry/telemetryMetrics";

export {
  createOtelSink,
  type OtelSinkOptions,
  type OtelTracerLike,
} from "./telemetry/otelSink";

// Reasoning
export {
  createReasoningFetch,
  createReasoningContentTransformStream,
} from "./reasoning/reasoningStream";

// MCP (Model Context Protocol)
export {
  MCPClientManager,
  createClientTransport,
  adaptMcpToolToCoreTool,
  getCoreToolsFromMcp,
  type MCPServerConfig,
  type MCPTransportType,
  type MCPToolCallResult,
  type MCPClientStatus,
} from "./mcp";
