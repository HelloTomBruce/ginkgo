/**
 * 平台底层能力词汇表（AppServerContract.requiredCapabilities 的合法取值）。
 * 组合根（src/lib/apps/registry.ts）注册应用时逐项校验；新增底层能力时在此扩充。
 */
export const KNOWN_APP_CAPABILITIES = [
  "workspace_sandbox",
  "filesystem",
  "bash",
  "browser",
  "sql_query",
  "chart_spec",
  "methodology",
  "claude_design",
  "claude_design_system",
] as const;

export type KnownAppCapability = (typeof KNOWN_APP_CAPABILITIES)[number];
