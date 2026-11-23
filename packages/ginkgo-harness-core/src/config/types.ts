import { z } from "zod";

export type DeepPartial<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends Array<infer U>
  ? _DeepPartialArray<U>
  : T extends object
  ? _DeepPartialObject<T>
  : T | undefined;

type _DeepPartialArray<T> = Array<DeepPartial<T>>;
type _DeepPartialObject<T> = { [P in keyof T]?: DeepPartial<T[P]> };

export const ConcurrencyConfigSchema = z.object({
  maxConcurrent: z.number().int().positive().default(10),
  queueTimeoutMs: z.number().int().nonnegative().default(30000),
});

export const CredentialGuardConfigSchema = z.object({
  allowedHosts: z.array(z.string()).default([]),
  requireApiKey: z.boolean().default(true),
});

export const TenantQuotaConfigSchema = z.object({
  defaultDailyBudgetUsd: z.number().positive().default(50.0),
  defaultTokenLimit: z.number().int().positive().default(10_000_000),
  windowMs: z.number().int().positive().default(86_400_000),
});

export const PipelineConfigSchema = z.object({
  concurrency: ConcurrencyConfigSchema.default({
    maxConcurrent: 10,
    queueTimeoutMs: 30000,
  }),
  credentialGuard: CredentialGuardConfigSchema.default({
    allowedHosts: [],
    requireApiKey: true,
  }),
  tenantQuota: TenantQuotaConfigSchema.default({
    defaultDailyBudgetUsd: 50.0,
    defaultTokenLimit: 10_000_000,
    windowMs: 86_400_000,
  }),
});

export const GraphConfigSchema = z.object({
  maxSteps: z.number().int().positive().default(25),
  recursionLimit: z.number().int().positive().default(50),
  checkpointerType: z.enum(["memory", "redis", "file"]).default("memory"),
});

export const ResilienceConfigSchema = z.object({
  timeoutMs: z.number().int().positive().default(30000),
  maxRetries: z.number().int().nonnegative().default(3),
  initialDelayMs: z.number().int().nonnegative().default(1000),
  maxDelayMs: z.number().int().positive().default(10000),
  backoffFactor: z.number().positive().default(2),
  fallbackModels: z.array(z.string()).default([]),
});

export const AutoHealingConfigSchema = z.object({
  maxAttempts: z.number().int().nonnegative().default(2),
  temperature: z.number().min(0).max(2).default(0.1),
});

export const GuardrailsConfigSchema = z.object({
  autoHealing: AutoHealingConfigSchema.default({
    maxAttempts: 2,
    temperature: 0.1,
  }),
});

export const FinOpsConfigSchema = z.object({
  storeType: z.enum(["memory", "ndjson", "redis"]).default("memory"),
  storagePath: z.string().default("./data/cost-ledger.ndjson"),
  redisUrl: z.string().optional(),
  pricingOverrides: z.record(
    z.string(),
    z.object({
      promptPer1M: z.number().nonnegative(),
      completionPer1M: z.number().nonnegative(),
    })
  ).default({}),
});

export const StreamConfigSchema = z.object({
  storeType: z.enum(["memory", "file", "redis"]).default("memory"),
  taskTtlMs: z.number().int().positive().default(3600000),
  fileStoreDir: z.string().optional(),
  redisUrl: z.string().optional(),
  heartbeatIntervalMs: z.number().int().positive().default(15000),
});

export const McpReconnectConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative().default(3),
  delayMs: z.number().int().nonnegative().default(1000),
});

export const McpConfigSchema = z.object({
  defaultTimeoutMs: z.number().int().positive().default(30000),
  maxPoolSize: z.number().int().positive().default(5),
  reconnect: McpReconnectConfigSchema.default({
    maxRetries: 3,
    delayMs: 1000,
  }),
});

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sampleRate: z.number().min(0).max(1).default(1.0),
  exporter: z.enum(["console", "otel", "none"]).default("console"),
  otelEndpoint: z.string().optional(),
});

/**
 * Harness Core 根配置 Schema（Zod 运行时校验 + 类型推导）
 */
export const HarnessConfigSchema = z.object({
  pipeline: PipelineConfigSchema.default({
    concurrency: { maxConcurrent: 10, queueTimeoutMs: 30000 },
    credentialGuard: { allowedHosts: [], requireApiKey: true },
    tenantQuota: {
      defaultDailyBudgetUsd: 50.0,
      defaultTokenLimit: 10_000_000,
      windowMs: 86_400_000,
    },
  }),
  graph: GraphConfigSchema.default({
    maxSteps: 25,
    recursionLimit: 50,
    checkpointerType: "memory",
  }),
  resilience: ResilienceConfigSchema.default({
    timeoutMs: 30000,
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffFactor: 2,
    fallbackModels: [],
  }),
  guardrails: GuardrailsConfigSchema.default({
    autoHealing: { maxAttempts: 2, temperature: 0.1 },
  }),
  finops: FinOpsConfigSchema.default({
    storeType: "memory",
    storagePath: "./data/cost-ledger.ndjson",
    pricingOverrides: {},
  }),
  stream: StreamConfigSchema.default({
    storeType: "memory",
    taskTtlMs: 3600000,
    heartbeatIntervalMs: 15000,
  }),
  mcp: McpConfigSchema.default({
    defaultTimeoutMs: 30000,
    maxPoolSize: 5,
    reconnect: { maxRetries: 3, delayMs: 1000 },
  }),
  telemetry: TelemetryConfigSchema.default({
    enabled: true,
    sampleRate: 1.0,
    exporter: "console",
  }),
});

export type HarnessConfig = DeepPartial<z.input<typeof HarnessConfigSchema>>;
export type ResolvedHarnessConfig = z.output<typeof HarnessConfigSchema>;
