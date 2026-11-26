import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDesignHealth } from "./health";

const probeCliAvailable = vi.fn<(bin: string) => Promise<boolean>>();

vi.mock("./cliBridge", () => ({
  probeCliAvailable: (bin: string) => probeCliAvailable(bin),
}));

/**
 * design 的健康检查是「应用自治探测」的参考实现：
 * 缺失项与修复指引都由应用给出，宿主只负责展示。
 */
describe("checkDesignHealth 设计 CLI 依赖探测", () => {
  beforeEach(() => {
    probeCliAvailable.mockReset();
  });

  it("两个 CLI 都可用 → ready", async () => {
    probeCliAvailable.mockResolvedValue(true);

    const result = await checkDesignHealth();

    expect(result.healthy).toBe(true);
    expect(result.status).toBe("ready");
    expect(probeCliAvailable).toHaveBeenCalledWith("claude-design");
    expect(probeCliAvailable).toHaveBeenCalledWith("claude-design-system");
  });

  it("两个都缺失 → missing_deps + 逐项修复指引", async () => {
    probeCliAvailable.mockResolvedValue(false);

    const result = await checkDesignHealth();

    expect(result.status).toBe("missing_deps");
    expect(result.missingCapabilities).toEqual([
      "cli:claude-design",
      "cli:claude-design-system",
    ]);
    expect(result.remediationGuide).toContain("npm install -g claude-design");
    expect(result.remediationGuide).toContain(
      "npm install -g claude-design-system"
    );
    expect(result.message).toContain("体验设计工坊");
  });

  it("只缺其一 → 只报缺失项", async () => {
    probeCliAvailable.mockImplementation(async (bin) =>
      bin === "claude-design"
    );

    const result = await checkDesignHealth();

    expect(result.missingCapabilities).toEqual(["cli:claude-design-system"]);
    expect(result.remediationGuide).toBe("npm install -g claude-design-system");
  });
});
