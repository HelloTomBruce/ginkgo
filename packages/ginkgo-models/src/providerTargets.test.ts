import { describe, it, expect } from "vitest";
import {
  buildIdentityHeaders,
  describeIdentityHeaders,
  formatUserAgent,
  mergeIdentityHeaders,
  normalizeHeaderEntries,
  PROVIDER_TARGET_RULES,
  resolveProviderTarget,
  resolveSessionHeaderPlaceholders,
  CLIENT_PRODUCT,
} from "./providerTargets";
import pkg from "../package.json";

/**
 * 身份层：按目标端点决定默认请求头。
 *
 * 设计契约（借鉴 DSH/pi-ai）：identity 默认头 < 用户配置；用户配置优先。
 */
describe("resolveProviderTarget", () => {
  it("按 host 识别 opencode（含子域与自定义路径）", () => {
    expect(resolveProviderTarget("https://opencode.ai/inference/go/openai/v1")).toBe("opencode");
    expect(resolveProviderTarget("https://api.opencode.ai/v1")).toBe("opencode");
  });

  it("按 host 识别 openrouter", () => {
    expect(resolveProviderTarget("https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(resolveProviderTarget("https://us.openrouter.ai/api/v1")).toBe("openrouter");
  });

  it("按 host 识别 nvidia", () => {
    expect(resolveProviderTarget("https://integrate.api.nvidia.com/v1")).toBe("nvidia");
  });

  it("其它端点归为 generic", () => {
    expect(resolveProviderTarget("https://api.openai.com/v1")).toBe("generic");
    expect(resolveProviderTarget("https://api.deepseek.com/v1")).toBe("generic");
    expect(resolveProviderTarget("http://localhost:11434/v1")).toBe("generic");
  });

  it("非法 URL 不抛错，归为 generic", () => {
    expect(resolveProviderTarget("not-a-url")).toBe("generic");
    expect(resolveProviderTarget("")).toBe("generic");
  });

  it("不把相似域名误判为 opencode（防后缀混淆）", () => {
    expect(resolveProviderTarget("https://fakeopencode.ai/v1")).toBe("generic");
    expect(resolveProviderTarget("https://opencode.ai.evil.com/v1")).toBe("generic");
  });
});

describe("formatUserAgent", () => {
  it("包含产品名与版本", () => {
    const ua = formatUserAgent("0.1.3");
    expect(ua.startsWith(`${CLIENT_PRODUCT}/0.1.3`)).toBe(true);
  });

  it("包含平台与运行时信息（自报身份，符合 OpenCode 要求）", () => {
    const ua = formatUserAgent("0.1.3");
    expect(ua).toContain(process.platform);
    expect(ua).toContain(process.arch);
    expect(ua).toContain("node/");
  });

  it("缺版本时用包版本（= 平台版本），不产生 ginkgo/unknown", () => {
    // 11 个包经 pkg:bump 版本锁定，models 的版本即平台版本；
    // 回归守卫：若 UA 出现 unknown 说明版本导入链断了（opencode 自报身份失效）
    expect(formatUserAgent()).toContain(`${CLIENT_PRODUCT}/${pkg.version}`);
    expect(formatUserAgent()).not.toContain("unknown");
  });
});

describe("buildIdentityHeaders", () => {
  it("opencode：带 client 标识与 session", () => {
    expect(buildIdentityHeaders("opencode", { sessionId: "s1" })).toMatchObject({
      "x-opencode-client": CLIENT_PRODUCT,
      "x-opencode-session": "s1",
    });
  });

  it("opencode：无 sessionId 时不发空串", () => {
    const h = buildIdentityHeaders("opencode", {});
    expect("x-opencode-session" in h).toBe(false);
  });

  it("openrouter：带归属头", () => {
    expect(buildIdentityHeaders("openrouter")).toMatchObject({
      "HTTP-Referer": expect.any(String),
      "X-OpenRouter-Title": CLIENT_PRODUCT,
    });
  });

  it("nvidia：来源标识首字母大写", () => {
    expect(buildIdentityHeaders("nvidia")["X-BILLING-INVOKE-ORIGIN"]).toBe("Ginkgo");
  });

  it("generic：只有 User-Agent", () => {
    expect(Object.keys(buildIdentityHeaders("generic"))).toEqual(["User-Agent"]);
  });

  it("disabled 时返回空对象（完全裸请求）", () => {
    expect(buildIdentityHeaders("opencode", { sessionId: "s1", disabled: true })).toEqual({});
  });
});

describe("mergeIdentityHeaders", () => {
  it("用户头覆盖默认（大小写不敏感，不残留同名异形）", () => {
    const merged = mergeIdentityHeaders({ "User-Agent": "ginkgo/1" }, { "user-agent": "custom/2" });
    expect(merged).toEqual({ "user-agent": "custom/2" });
    expect(merged?.["User-Agent"]).toBeUndefined();
  });

  it("无用户头时保留身份头", () => {
    expect(mergeIdentityHeaders({ "User-Agent": "ginkgo/1" })).toEqual({ "User-Agent": "ginkgo/1" });
  });

  it("空用户头视为未提供", () => {
    expect(mergeIdentityHeaders({ "User-Agent": "ginkgo/1" }, {})).toEqual({
      "User-Agent": "ginkgo/1",
    });
  });

  it("身份头为空时只返回用户头", () => {
    expect(mergeIdentityHeaders({}, { "x-custom": "v" })).toEqual({ "x-custom": "v" });
  });

  it("两者都空时返回 undefined（不注入空对象）", () => {
    expect(mergeIdentityHeaders({}, {})).toBeUndefined();
  });

  it("追加不同名的用户头（不覆盖身份头）", () => {
    const merged = mergeIdentityHeaders({ "User-Agent": "ginkgo/1" }, { "x-extra": "v" });
    expect(merged).toEqual({ "User-Agent": "ginkgo/1", "x-extra": "v" });
  });
});

describe("PROVIDER_TARGET_RULES 数据表", () => {
  it("每个目标都声明了 label / hosts / headers（UI 提示依赖它）", () => {
    for (const [target, rule] of Object.entries(PROVIDER_TARGET_RULES)) {
      expect(rule.label, `${target} 缺 label`).toBeTruthy();
      expect(rule.hosts.length, `${target} 缺 hosts`).toBeGreaterThan(0);
      expect(rule.headers.length, `${target} 缺 headers`).toBeGreaterThan(0);
    }
  });

  it("规则表的 host 都能被 resolveProviderTarget 命中（自洽）", () => {
    for (const [target, rule] of Object.entries(PROVIDER_TARGET_RULES)) {
      for (const host of rule.hosts) {
        expect(resolveProviderTarget(`https://${host}/v1`)).toBe(target);
      }
    }
  });
});

describe("normalizeHeaderEntries（基础归一化，不含安全判定）", () => {
  it("接受对象与数组两种形态", () => {
    expect(normalizeHeaderEntries({ " x-a ": " 1 " })).toEqual({ "x-a": "1" });
    expect(normalizeHeaderEntries([{ name: "x-b", value: "2" }])).toEqual({ "x-b": "2" });
  });

  it("丢弃空名/空值/非字符串", () => {
    expect(
      normalizeHeaderEntries({ "": "v", "x-empty": "  ", "x-num": 1, "x-ok": "v" })
    ).toEqual({ "x-ok": "v" });
  });

  it("不做安全判定：敏感头照常通过（由服务端护栏拒绝）", () => {
    expect(normalizeHeaderEntries({ Authorization: "Bearer x" })).toEqual({
      Authorization: "Bearer x",
    });
  });

  it("无有效条目时返回 undefined", () => {
    expect(normalizeHeaderEntries({})).toBeUndefined();
    expect(normalizeHeaderEntries([])).toBeUndefined();
    expect(normalizeHeaderEntries("str")).toBeUndefined();
    expect(normalizeHeaderEntries(null)).toBeUndefined();
  });
});

describe("describeIdentityHeaders（设置页提示，由规则生成）", () => {
  it("识别 opencode 时列出自动注入的头", () => {
    const text = describeIdentityHeaders("https://opencode.ai/inference/go/openai/v1");
    expect(text).toContain("OpenCode");
    expect(text).toContain("x-opencode-session");
  });

  it("通用端点提示无需额外身份头", () => {
    expect(describeIdentityHeaders("https://api.deepseek.com/v1")).toContain("无需额外身份头");
  });
});

/**
 * {{sessionId}} 占位符（真实实现的直接测试——此前 llm 测试文件里是本地
 * 重实现的拷贝，改 handler 正则测试照样绿，属于假覆盖）。
 * OpenCode Go 要求每会话稳定的 session ID，占位符是手动配置的会话区分机制。
 */
describe("resolveSessionHeaderPlaceholders", () => {
  it("替换为实际会话 id", () => {
    expect(resolveSessionHeaderPlaceholders({ "x-opencode-session": "{{sessionId}}" }, "sess_abc")).toEqual({
      "x-opencode-session": "sess_abc",
    });
  });

  it("支持带空格的占位符写法", () => {
    expect(
      resolveSessionHeaderPlaceholders({ "x-opencode-session": "prefix-{{ sessionId }}-suffix" }, "s1")
    ).toEqual({ "x-opencode-session": "prefix-s1-suffix" });
  });

  it("多个头同时替换", () => {
    expect(
      resolveSessionHeaderPlaceholders({ a: "{{sessionId}}", b: "x-{{sessionId}}-y", c: "static" }, "s2")
    ).toEqual({ a: "s2", b: "x-s2-y", c: "static" });
  });

  it("无会话 id 时原样返回同一对象（不发送空字符串/占位符被清空）", () => {
    const input = { "x-opencode-session": "{{sessionId}}" };
    expect(resolveSessionHeaderPlaceholders(input, undefined)).toBe(input);
  });

  it("静态值不受影响", () => {
    expect(resolveSessionHeaderPlaceholders({ "User-Agent": "ginkgo-agent/0.1.3" }, "s1")).toEqual({
      "User-Agent": "ginkgo-agent/0.1.3",
    });
  });

  it("同一值内多次出现全部替换", () => {
    expect(resolveSessionHeaderPlaceholders({ x: "{{sessionId}}-{{sessionId}}" }, "s3")).toEqual({
      x: "s3-s3",
    });
  });
});
