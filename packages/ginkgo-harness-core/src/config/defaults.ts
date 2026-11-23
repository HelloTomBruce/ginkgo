import { HarnessConfigSchema, type ResolvedHarnessConfig } from "./types";

/**
 * 根默认配置（由 HarnessConfigSchema 派生）
 */
export const DEFAULT_HARNESS_CONFIG: ResolvedHarnessConfig = HarnessConfigSchema.parse({});

export const DEFAULT_PIPELINE_CONFIG = DEFAULT_HARNESS_CONFIG.pipeline;
export const DEFAULT_GRAPH_CONFIG = DEFAULT_HARNESS_CONFIG.graph;
export const DEFAULT_RESILIENCE_CONFIG = DEFAULT_HARNESS_CONFIG.resilience;
export const DEFAULT_GUARDRAILS_CONFIG = DEFAULT_HARNESS_CONFIG.guardrails;
export const DEFAULT_FINOPS_CONFIG = DEFAULT_HARNESS_CONFIG.finops;
export const DEFAULT_STREAM_CONFIG = DEFAULT_HARNESS_CONFIG.stream;
export const DEFAULT_MCP_CONFIG = DEFAULT_HARNESS_CONFIG.mcp;
export const DEFAULT_TELEMETRY_CONFIG = DEFAULT_HARNESS_CONFIG.telemetry;
