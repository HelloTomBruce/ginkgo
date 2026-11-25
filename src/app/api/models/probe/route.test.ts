import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

describe("POST /api/models/probe", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("缺少 baseURL 时返回 400", async () => {
    const req = new Request("http://localhost/api/models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("缺少或非法的 API 地址");
  });

  it("端点响应 200 时返回 ok=true 及延迟毫秒数", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gpt-4o" }] }),
    });

    const req = new Request("http://localhost/api/models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-valid-key",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.latencyMs).toBeGreaterThan(0);
    expect(data.message).toContain("连接成功");
  });

  it("端点响应 401 时返回 ok=false 及认证失效提示", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Invalid API Key" } }),
    });

    const req = new Request("http://localhost/api/models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-invalid-key",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.status).toBe(401);
    expect(data.error).toContain("Invalid API Key");
  });

  it("针对未带 /v1 的 Anthropic 兼容端点优先探测 /v1/models", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: ["kimi-k1.5"] }),
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({ error: { message: "The requested resource was not found" } }),
      };
    });
    global.fetch = fetchSpy;

    const req = new Request("http://localhost/api/models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseURL: "https://api.kimi.com/coding",
        apiKey: "sk-kimi-key",
        protocol: "anthropic",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toContain("连接成功");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.kimi.com/coding/v1/models");
  });

  it("当 GET /models 返回 404 时回退至 POST 对话端点探活且成功", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && (url.includes("/chat/completions") || url.includes("/messages"))) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "pong" } }] }),
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({ error: { message: "The requested resource was not found" } }),
      };
    });
    global.fetch = fetchSpy;

    const req = new Request("http://localhost/api/models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseURL: "https://gateway.example/v1",
        apiKey: "sk-test",
        protocol: "openai",
        model: "custom-model",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toContain("连接成功");
  });
});
