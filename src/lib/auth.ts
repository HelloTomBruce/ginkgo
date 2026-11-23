/**
 * 部署鉴权访问令牌（对应服务端 GINKGO_API_AUTH_TOKEN）。
 * 本地开发未配置服务端 token 时留空即可。
 */

export const ACCESS_TOKEN_STORAGE_KEY = "ginkgo_access_token";

export function getAccessToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "";
}

/** 为 API 请求生成鉴权头；未配置令牌时为空对象（可安全展开）。 */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * 带部署鉴权头的 fetch：宿主注入给应用插槽组件（设置分区等）的请求通道，
 * 语义同全局 fetch，自动附加访问令牌（已显式携带时以传入为准）。
 */
export function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getAccessToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(path, { ...init, headers });
}
