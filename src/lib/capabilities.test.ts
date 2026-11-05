import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  buildCapabilitySection,
  resolveCapabilities,
} from "@/lib/capabilities";
import { DEFAULT_WELCOME_MESSAGE, buildWelcomeMessage } from "@/lib/sessionStorage";

describe("能力注册表", () => {
  it("条目必备字段齐全且 alias 唯一", () => {
    const aliases = new Set<string>();
    for (const c of CAPABILITIES) {
      expect(c.icon).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.alias).toBeTruthy();
      expect(aliases.has(c.alias)).toBe(false);
      aliases.add(c.alias);
    }
  });

  it("无条件能力在任何上下文下都成立", () => {
    const resolved = resolveCapabilities();
    const unconditional = CAPABILITIES.filter((c) => !c.requiresFeature);
    expect(resolved).toEqual(expect.arrayContaining(unconditional));
    expect(resolved).toHaveLength(unconditional.length);
  });

  it("跨源联合分析：仅 features.crossSource 为 true 时成立", () => {
    const aliases = (list: ReturnType<typeof resolveCapabilities>) =>
      list.map((c) => c.alias);

    expect(aliases(resolveCapabilities())).not.toContain("Cross-Source Insights");
    expect(
      aliases(resolveCapabilities({ features: { crossSource: false } }))
    ).not.toContain("Cross-Source Insights");
    expect(
      aliases(resolveCapabilities({ features: { crossSource: true } }))
    ).toContain("Cross-Source Insights");
  });

  it("生成的能力段落与判定结果一致", () => {
    const section = buildCapabilitySection();
    expect(section).toContain("本系统已深度集成：");
    expect(section).not.toContain("Cross-Source Insights");
    // 行数 = 标题行 + 条目数
    expect(section.split("\n")).toHaveLength(resolveCapabilities().length + 1);
  });

  it("能力文案不出现任何具体数据源名（数据源全部由用户配置）", () => {
    const all = buildCapabilitySection({ features: { crossSource: true } });
    expect(all).not.toMatch(/禅道|zentao|gitlab/i);
  });
});

describe("欢迎语与注册表防漂移", () => {
  it("无条件能力始终出现在欢迎语中", () => {
    for (const c of CAPABILITIES.filter((c) => !c.requiresFeature)) {
      expect(DEFAULT_WELCOME_MESSAGE.content).toContain(c.name);
      expect(DEFAULT_WELCOME_MESSAGE.content).toContain(c.alias);
    }
  });

  it("默认（无特性开关）欢迎语不含跨源联合分析宣称", () => {
    expect(DEFAULT_WELCOME_MESSAGE.content).not.toContain("Cross-Source Insights");
    expect(DEFAULT_WELCOME_MESSAGE.content).not.toContain("跨源联合分析");
  });

  it("crossSource 特性开启时欢迎语包含跨源能力（泛化措辞）", () => {
    const msg = buildWelcomeMessage({ features: { crossSource: true } });
    expect(msg.content).toContain("跨源联合分析");
    expect(msg.content).toContain("Cross-Source Insights");
    expect(msg.id).toBe("welcome");
  });

  it("欢迎语保留设置引导且不含内置表述", () => {
    expect(DEFAULT_WELCOME_MESSAGE.content).toContain("设置 → 数据源");
    expect(DEFAULT_WELCOME_MESSAGE.content).not.toContain("内置");
  });
});
