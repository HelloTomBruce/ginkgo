import { HarnessConfigSchema, type HarnessConfig, type ResolvedHarnessConfig } from "./types";
import { loadHarnessConfigFromEnv } from "./envLoader";

/** 深度合并两个配置对象（target <- source） */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source?: Record<string, unknown>
): T {
  if (!source) return target;
  const output: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (val === undefined) continue;
    const targetVal = output[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      output[key] = deepMerge(
        targetVal as Record<string, unknown>,
        val as Record<string, unknown>
      );
    } else {
      output[key] = val;
    }
  }
  return output as T;
}

/**
 * 解析并最终确定完整的 Harness 配置对象。
 * 遵循三级级联覆盖原则：
 * 1. 内置安全默认值 (Defaults)
 * 2. 环境变量 (Env)
 * 3. 调用方显式传入的运行时覆盖 (userConfig)
 */
export function resolveHarnessConfig(
  userConfig?: HarnessConfig,
  env?: Record<string, string | undefined>
): ResolvedHarnessConfig {
  const envConfig = loadHarnessConfigFromEnv(env);
  const merged = deepMerge(
    deepMerge({}, envConfig as Record<string, unknown>),
    userConfig as Record<string, unknown> | undefined
  );
  return HarnessConfigSchema.parse(merged);
}
