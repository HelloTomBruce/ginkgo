import pkg from "../package.json";

/**
 * Provider 目标识别与身份头规则（单一事实来源）。
 *
 * 为什么放在 models 包：这份知识同时被**服务端装配**（harness-core 的 provider
 * factory 注入默认头）和**客户端设置页**（提示「该端点会自动带哪些头」）消费。
 * 分散在两处必然漂移（改了规则忘了改文案）。
 *
 * 分层契约（与 DSH/pi-ai 一致）：
 *   identity 默认头（本文件） < 用户自定义头（ConfiguredProvider.headers）
 * 用户配置永远优先，可覆盖 User-Agent、替换 session 取值。
 *
 * 安全边界**不在这里**：敏感头拒绝（Authorization/Content-Type/Cookie…）
 * 必须由服务端执行，见 ginkgo-llm handler 的 normalizeCustomHeaders。
 */

/** 客户端产品名（出现在 User-Agent 与归属头里） */
export const CLIENT_PRODUCT = "ginkgo";

/** 归属站点（OpenRouter 的 HTTP-Referer 用） */
const CLIENT_URL = "https://github.com/HelloTomBruce/ginkgo";

/** 目标 Provider 家族 */
export type ProviderTarget = "opencode" | "openrouter" | "nvidia" | "generic";

/**
 * 目标规则表：host 匹配 + 该目标会自动注入的头。
 * 新增适配只需在此追加一条，客户端提示与服务端注入同时生效。
 */
export const PROVIDER_TARGET_RULES: Record<
  Exclude<ProviderTarget, "generic">,
  {
    /** 展示名（用于设置页提示） */
    label: string;
    /** host 精确匹配或子域匹配 */
    hosts: string[];
    /** 自动注入的头名（不含恒有的 User-Agent） */
    headers: string[];
  }
> = {
  opencode: {
    label: "OpenCode",
    hosts: ["opencode.ai"],
    headers: ["x-opencode-client", "x-opencode-session"],
  },
  openrouter: {
    label: "OpenRouter",
    hosts: ["openrouter.ai"],
    headers: ["HTTP-Referer", "X-OpenRouter-Title"],
  },
  nvidia: {
    label: "NVIDIA NIM",
    hosts: ["integrate.api.nvidia.com"],
    headers: ["X-BILLING-INVOKE-ORIGIN"],
  },
};

function hostOf(baseURL: string): string | undefined {
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function hostMatches(host: string | undefined, expected: string): boolean {
  if (!host) return false;
  return host === expected || host.endsWith(`.${expected}`);
}

/**
 * 按 baseURL 的 host 识别目标 Provider。
 * 只看 host（不看 provider id），因此「自定义 Provider 指向 opencode.ai」
 * 也能被正确识别。host 必须精确相等或以 `.` 前缀匹配，防止
 * `fakeopencode.ai` / `opencode.ai.evil.com` 之类后缀混淆。
 */
export function resolveProviderTarget(baseURL: string): ProviderTarget {
  const host = hostOf(baseURL);
  for (const [target, rule] of Object.entries(PROVIDER_TARGET_RULES)) {
    if (rule.hosts.some((expected) => hostMatches(host, expected))) {
      return target as ProviderTarget;
    }
  }
  return "generic";
}

/** 运行时描述：`node/v22.11.0` / `bun/1.1.0`（浏览器环境返回 undefined） */
function runtimeDescription(): string | undefined {
  if (typeof process === "undefined" || !process.versions) return undefined;
  const v = process.versions as Record<string, string | undefined>;
  if (v.bun) return `bun/${v.bun}`;
  if (v.node) return `node/${v.node}`;
  return undefined;
}

/**
 * 构造详细 User-Agent：`ginkgo/0.1.3 (darwin; node/v22.11.0; arm64)`。
 * 遵循 OpenCode 的建议——客户端自报身份，而非通用 SDK/HTTP 库名。
 *
 * 版本默认取本包 package.json（11 个包经 pkg:bump 版本锁定，等价于平台版本）；
 * tsup 构建时 esbuild 会把 JSON 内联进产物，发布物携带的即构建时版本。
 */
export function formatUserAgent(version?: string): string {
  const product = `${CLIENT_PRODUCT}/${version?.trim() || pkg.version}`;
  const runtime = runtimeDescription();
  const platform = typeof process !== "undefined" ? process.platform : undefined;
  const arch = typeof process !== "undefined" ? process.arch : undefined;
  if (!platform || !arch) return product;
  return runtime ? `${product} (${platform}; ${runtime}; ${arch})` : `${product} (${platform}; ${arch})`;
}

export interface IdentityContext {
  /** 每会话稳定 ID（opencode 的路由与 prompt caching 依赖它） */
  sessionId?: string;
  /** 客户端版本；缺省取本包 package.json 版本（= 平台版本） */
  version?: string;
  /** 关闭全部身份头（完全裸请求） */
  disabled?: boolean;
}

/**
 * 生成身份头。`x-opencode-session` 只在有 sessionId 时注入——
 * 网关收到空串比收不到更糟。
 */
export function buildIdentityHeaders(
  target: ProviderTarget,
  ctx: IdentityContext = {}
): Record<string, string> {
  if (ctx.disabled) return {};
  const headers: Record<string, string> = {
    "User-Agent": formatUserAgent(ctx.version),
  };

  if (target === "opencode") {
    headers["x-opencode-client"] = CLIENT_PRODUCT;
    if (ctx.sessionId) headers["x-opencode-session"] = ctx.sessionId;
  } else if (target === "openrouter") {
    headers["HTTP-Referer"] = CLIENT_URL;
    headers["X-OpenRouter-Title"] = CLIENT_PRODUCT;
  } else if (target === "nvidia") {
    // NVIDIA 要求来源标识首字母大写
    headers["X-BILLING-INVOKE-ORIGIN"] =
      CLIENT_PRODUCT.charAt(0).toUpperCase() + CLIENT_PRODUCT.slice(1);
  }

  return headers;
}

/**
 * 合并身份头与用户自定义头：**用户配置优先**。
 * 覆盖是大小写不敏感的（用户写 `user-agent` 会压掉默认 `User-Agent`，
 * 不残留两个同名头）。
 */
export function mergeIdentityHeaders(
  identity: Record<string, string>,
  userHeaders?: Record<string, string>
): Record<string, string> | undefined {
  if (!userHeaders || Object.keys(userHeaders).length === 0) {
    return Object.keys(identity).length > 0 ? identity : undefined;
  }
  const merged: Record<string, string> = { ...identity };
  for (const [name, value] of Object.entries(userHeaders)) {
    const lower = name.toLowerCase();
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === lower) delete merged[existing];
    }
    merged[name] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * 基础形态归一化：接受 `Record<string,string>` 或 `{name,value}[]`，
 * 去掉空名/空值/空白，返回 Record。
 *
 * **不做安全判定**（敏感头、长度、数量、换行）——那是服务端护栏的职责，
 * 见 ginkgo-llm 的 normalizeCustomHeaders。
 */
export function normalizeHeaderEntries(raw: unknown): Record<string, string> | undefined {
  const pairs: Array<[unknown, unknown]> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const it = item as Record<string, unknown>;
        pairs.push([it.name, it.value]);
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      pairs.push([k, v]);
    }
  } else {
    return undefined;
  }

  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of pairs) {
    if (typeof rawName !== "string" || typeof rawValue !== "string") continue;
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name || !value) continue;
    out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 设置页提示文本：说明该端点会自动带哪些头。
 * 由规则表生成，避免 UI 硬编码域名（改规则即改文案）。
 */
export function describeIdentityHeaders(baseURL: string): string {
  const target = resolveProviderTarget(baseURL);
  if (target === "generic") {
    return "该端点无需额外身份头，仅自动发送 User-Agent。";
  }
  const rule = PROVIDER_TARGET_RULES[target];
  return `已识别为 ${rule.label}：将自动发送 User-Agent 与 ${rule.headers.join("、")}。`;
}

const SESSION_ID_PLACEHOLDER_RE = /\{\{\s*sessionId\s*\}\}/g;

/**
 * 把自定义头值里的 `{{sessionId}}` 占位符替换为实际会话 id。
 *
 * OpenCode Go 要求 `x-opencode-session` 是**每会话稳定**的 ID（用于路由与
 * prompt caching）。用户填固定值会让所有会话共用一个桶、优化失效；写
 * `{{sessionId}}` 即自动按会话区分。无会话 id 时保留原样——把占位符字面量
 * 或空串发给网关都比保留原样更糟。
 */
export function resolveSessionHeaderPlaceholders(
  headers: Record<string, string>,
  sessionId: string | undefined
): Record<string, string> {
  if (!sessionId) return headers;
  // 无条件 replace（/g 正则的 replace 自身无 lastIndex 状态问题，别用 .test 预判）
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, v.replace(SESSION_ID_PLACEHOLDER_RE, sessionId)])
  );
}
