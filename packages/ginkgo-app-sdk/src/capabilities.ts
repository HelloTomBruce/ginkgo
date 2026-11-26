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
  "claude_data",
  "zentao_cli",
  "duckdb",
] as const;

export type KnownAppCapability = (typeof KNOWN_APP_CAPABILITIES)[number];

/**
 * 平台**自身提供**的能力（随宿主发布，无需外部安装）。
 *
 * 宿主只对这些能力做内置判定；其余能力（如 CLI 工具类）一律委托应用自己的
 * `server.healthCheck` 探测——宿主不持有「能力 → 外部命令」的映射表，
 * 否则就把应用领域知识写进了平台层。
 */
export const PLATFORM_PROVIDED_CAPABILITIES: readonly KnownAppCapability[] = [
  "workspace_sandbox",
  "filesystem",
  "bash",
  "browser",
  "sql_query",
  "chart_spec",
  "methodology",
  "duckdb",
];
