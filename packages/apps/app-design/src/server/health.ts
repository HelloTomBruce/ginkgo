import type { AppHealthCheckResult } from "@ginkgo/app-sdk";
import { probeCliAvailable } from "./cliBridge";

/**
 * design 应用的运行前健康检查（应用自治）。
 *
 * 为什么在这里而不是宿主：`claude_design` / `claude_design_system` 是本应用
 * 依赖的**外部 CLI**，属于应用领域知识。宿主若硬编码「能力 → 命令 → 修复指引」，
 * 平台层就被应用细节污染（此前 `capabilityNegotiator` 正是如此）。
 */
const CLI_CAPABILITIES = [
  {
    capability: "claude_design",
    bin: "claude-design",
    remediation: "npm install -g claude-design",
  },
  {
    capability: "claude_design_system",
    bin: "claude-design-system",
    remediation: "npm install -g claude-design-system",
  },
] as const;

export async function checkDesignHealth(): Promise<AppHealthCheckResult> {
  const missingCapabilities: string[] = [];
  const remediationSteps: string[] = [];

  for (const item of CLI_CAPABILITIES) {
    if (!(await probeCliAvailable(item.bin))) {
      missingCapabilities.push(`cli:${item.bin}`);
      remediationSteps.push(item.remediation);
    }
  }

  if (missingCapabilities.length > 0) {
    return {
      healthy: false,
      status: "missing_deps",
      missingCapabilities,
      remediationGuide: remediationSteps.join("；"),
      message: `体验设计工坊缺少外部 CLI 依赖（${missingCapabilities.join(
        ", "
      )}），设计稿生成与设计系统相关功能将不可用`,
    };
  }

  return {
    healthy: true,
    status: "ready",
    message: "设计 CLI 依赖就绪",
  };
}
