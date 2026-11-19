import type { HarnessConfig } from "./types";

function parsePositiveInt(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const num = parseInt(val, 10);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function parseNonNegativeInt(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const num = parseInt(val, 10);
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}

function parseNumber(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const num = parseFloat(val);
  return Number.isFinite(num) ? num : undefined;
}

function parseBoolean(val: string | undefined): boolean | undefined {
  if (!val) return undefined;
  const lower = val.trim().toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return undefined;
}

function parseCsv(val: string | undefined): string[] | undefined {
  if (!val) return undefined;
  const items = val.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseEnum<T extends string>(
  val: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (val && (allowed as readonly string[]).includes(val)) {
    return val as T;
  }
  return undefined;
}

const CHECKPOINTER_TYPES = ["memory", "redis", "file"] as const;
const FINOPS_STORE_TYPES = ["memory", "ndjson", "redis"] as const;
const STREAM_STORE_TYPES = ["memory", "file", "redis"] as const;
const TELEMETRY_EXPORTERS = ["console", "otel", "none"] as const;

/**
 * 从环境变量（默认 process.env）中提取并解析 Harness 配置对象。
 * 具备 HARNESS_* 前缀优先，同时平滑向后兼容既有的 LLM_* 与标准环境名。
 */
export function loadHarnessConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): HarnessConfig {
  const redisUrl = env.HARNESS_REDIS_URL || env.REDIS_URL;

  const config: HarnessConfig = {
    pipeline: {
      concurrency: {
        maxConcurrent: parsePositiveInt(
          env.HARNESS_CONCURRENCY_MAX || env.CONCURRENCY_MAX
        ),
        queueTimeoutMs: parseNonNegativeInt(
          env.HARNESS_CONCURRENCY_TIMEOUT_MS
        ),
      },
      credentialGuard: {
        allowedHosts: parseCsv(env.HARNESS_CREDENTIAL_ALLOWED_HOSTS),
        requireApiKey: parseBoolean(env.HARNESS_REQUIRE_API_KEY),
      },
      tenantQuota: {
        defaultDailyBudgetUsd: parseNumber(
          env.HARNESS_TENANT_DAILY_BUDGET_USD
        ),
        defaultTokenLimit: parsePositiveInt(
          env.HARNESS_TENANT_TOKEN_LIMIT
        ),
        windowMs: parsePositiveInt(
          env.HARNESS_TENANT_QUOTA_WINDOW_MS
        ),
      },
    },

    graph: {
      maxSteps: parsePositiveInt(
        env.HARNESS_GRAPH_MAX_STEPS || env.LLM_MAX_STEPS
      ),
      recursionLimit: parsePositiveInt(
        env.HARNESS_GRAPH_RECURSION_LIMIT
      ),
      checkpointerType: parseEnum(
        env.HARNESS_GRAPH_CHECKPOINTER,
        CHECKPOINTER_TYPES
      ),
    },

    resilience: {
      timeoutMs: parsePositiveInt(
        env.HARNESS_RESILIENCE_TIMEOUT_MS || env.LLM_TIMEOUT_MS
      ),
      maxRetries: parseNonNegativeInt(
        env.HARNESS_RESILIENCE_MAX_RETRIES
      ),
      initialDelayMs: parseNonNegativeInt(
        env.HARNESS_RESILIENCE_INITIAL_DELAY_MS
      ),
      maxDelayMs: parsePositiveInt(
        env.HARNESS_RESILIENCE_MAX_DELAY_MS
      ),
      backoffFactor: parseNumber(
        env.HARNESS_RESILIENCE_BACKOFF_FACTOR
      ),
      fallbackModels: parseCsv(
        env.HARNESS_FALLBACK_MODELS || env.LLM_FALLBACK_MODELS
      ),
    },

    guardrails: {
      autoHealing: {
        maxAttempts: parseNonNegativeInt(
          env.HARNESS_AUTO_HEALING_MAX_ATTEMPTS
        ),
        temperature: parseNumber(
          env.HARNESS_AUTO_HEALING_TEMPERATURE
        ),
      },
    },

    finops: {
      storeType: parseEnum(
        env.HARNESS_FINOPS_STORE_TYPE || env.LLM_COST_STORE,
        FINOPS_STORE_TYPES
      ),
      storagePath: env.HARNESS_FINOPS_STORAGE_PATH || env.LLM_COST_STORE_PATH,
      redisUrl,
    },

    stream: {
      storeType: parseEnum(
        env.HARNESS_STREAM_STORE_TYPE || env.LLM_TASK_STORE,
        STREAM_STORE_TYPES
      ),
      taskTtlMs: parsePositiveInt(
        env.HARNESS_STREAM_TASK_TTL_MS
      ),
      fileStoreDir: env.HARNESS_STREAM_FILE_DIR || env.LLM_TASK_STORE_DIR,
      redisUrl,
      heartbeatIntervalMs: parsePositiveInt(
        env.HARNESS_STREAM_HEARTBEAT_MS
      ),
    },

    mcp: {
      defaultTimeoutMs: parsePositiveInt(
        env.HARNESS_MCP_TIMEOUT_MS
      ),
      maxPoolSize: parsePositiveInt(
        env.HARNESS_MCP_MAX_POOL_SIZE
      ),
      reconnect: {
        maxRetries: parseNonNegativeInt(
          env.HARNESS_MCP_RECONNECT_MAX_RETRIES
        ),
        delayMs: parseNonNegativeInt(
          env.HARNESS_MCP_RECONNECT_DELAY_MS
        ),
      },
    },

    telemetry: {
      enabled: parseBoolean(
        env.HARNESS_TELEMETRY_ENABLED
      ),
      sampleRate: parseNumber(
        env.HARNESS_TELEMETRY_SAMPLE_RATE
      ),
      exporter: parseEnum(
        env.HARNESS_TELEMETRY_EXPORTER,
        TELEMETRY_EXPORTERS
      ),
      otelEndpoint:
        env.HARNESS_OTEL_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
  };

  return cleanUndefined(config);
}

/** 深度清理对象中的 undefined 属性，确保安全合并 */
function cleanUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return obj;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const cleaned = cleanUndefined(value);
      if (Object.keys(cleaned).length > 0) {
        result[key] = cleaned;
      }
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
