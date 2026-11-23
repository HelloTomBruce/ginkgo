import { describe, it, expect } from "vitest";
import {
  DEFAULT_HARNESS_CONFIG,
  loadHarnessConfigFromEnv,
  resolveHarnessConfig,
  HarnessConfigSchema,
} from "./index";

describe("Harness-Core 分层配置体系", () => {
  it("DEFAULT_HARNESS_CONFIG 提供合规安全的内建基线", () => {
    expect(DEFAULT_HARNESS_CONFIG.pipeline.concurrency.maxConcurrent).toBe(10);
    expect(DEFAULT_HARNESS_CONFIG.graph.maxSteps).toBe(25);
    expect(DEFAULT_HARNESS_CONFIG.resilience.timeoutMs).toBe(30000);
    expect(DEFAULT_HARNESS_CONFIG.resilience.maxRetries).toBe(3);
    expect(DEFAULT_HARNESS_CONFIG.guardrails.autoHealing.maxAttempts).toBe(2);
    expect(DEFAULT_HARNESS_CONFIG.finops.storeType).toBe("memory");
    expect(DEFAULT_HARNESS_CONFIG.stream.storeType).toBe("memory");
    expect(DEFAULT_HARNESS_CONFIG.mcp.defaultTimeoutMs).toBe(30000);
    expect(DEFAULT_HARNESS_CONFIG.mcp.maxPoolSize).toBe(5);
    expect(DEFAULT_HARNESS_CONFIG.telemetry.enabled).toBe(true);
  });

  it("loadHarnessConfigFromEnv 正确提取 HARNESS_* 环境变量及平滑兼容 LLM_*", () => {
    const env = {
      HARNESS_CONCURRENCY_MAX: "20",
      LLM_MAX_STEPS: "35",
      HARNESS_RESILIENCE_TIMEOUT_MS: "60000",
      HARNESS_FALLBACK_MODELS: "gpt-4o, claude-3-5-sonnet",
      HARNESS_AUTO_HEALING_MAX_ATTEMPTS: "5",
      LLM_COST_STORE: "redis",
      HARNESS_REDIS_URL: "redis://cluster:6379",
      HARNESS_MCP_TIMEOUT_MS: "45000",
      HARNESS_TELEMETRY_ENABLED: "false",
    };

    const parsed = loadHarnessConfigFromEnv(env);

    expect(parsed.pipeline?.concurrency?.maxConcurrent).toBe(20);
    expect(parsed.graph?.maxSteps).toBe(35);
    expect(parsed.resilience?.timeoutMs).toBe(60000);
    expect(parsed.resilience?.fallbackModels).toEqual(["gpt-4o", "claude-3-5-sonnet"]);
    expect(parsed.guardrails?.autoHealing?.maxAttempts).toBe(5);
    expect(parsed.finops?.storeType).toBe("redis");
    expect(parsed.finops?.redisUrl).toBe("redis://cluster:6379");
    expect(parsed.stream?.redisUrl).toBe("redis://cluster:6379");
    expect(parsed.mcp?.defaultTimeoutMs).toBe(45000);
    expect(parsed.telemetry?.enabled).toBe(false);
  });

  it("resolveHarnessConfig 实现 Defaults < Env < UserConfig 三级级联覆盖", () => {
    const mockEnv = {
      HARNESS_CONCURRENCY_MAX: "15",
      HARNESS_RESILIENCE_TIMEOUT_MS: "45000",
      HARNESS_GRAPH_MAX_STEPS: "30",
    };

    // 用户在运行时仅覆盖 timeoutMs 与 maxSteps
    const resolved = resolveHarnessConfig(
      {
        resilience: {
          timeoutMs: 12000,
        },
        mcp: {
          maxPoolSize: 10,
        },
      },
      mockEnv
    );

    // 1. 来自 Env 覆盖了 Default
    expect(resolved.pipeline.concurrency.maxConcurrent).toBe(15);
    expect(resolved.graph.maxSteps).toBe(30);

    // 2. 来自 UserConfig 覆盖了 Env 与 Default
    expect(resolved.resilience.timeoutMs).toBe(12000);

    // 3. 来自 UserConfig 覆盖了 Default
    expect(resolved.mcp.maxPoolSize).toBe(10);

    // 4. 未指定的保留 Default
    expect(resolved.resilience.maxRetries).toBe(3);
    expect(resolved.guardrails.autoHealing.maxAttempts).toBe(2);
    expect(resolved.finops.storeType).toBe("memory");
  });

  it("非法输入触发 Zod 校验错误", () => {
    expect(() =>
      HarnessConfigSchema.parse({
        pipeline: {
          concurrency: {
            maxConcurrent: -5, // 必须是正数
          },
        },
      })
    ).toThrow();

    expect(() =>
      HarnessConfigSchema.parse({
        finops: {
          storeType: "invalid-store-type", // 非法枚举
        },
      })
    ).toThrow();
  });
});
