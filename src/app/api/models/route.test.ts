import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";

describe("POST /api/models", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("缺少 baseURL 时返回 400", async () => {
    const req = new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("成功拉取 OpenAI 格式模型列表并排序去重", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "gpt-4o" }],
      }),
    });

    const req = new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-test",
        protocol: "openai",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("上游失败时返回错误描述不抛异常", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Invalid API Key" } }),
    });

    const req = new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-bad",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Invalid API Key");
  });

  it("当上游返回 404 (无 /models 端点) 但命中预设时，自动优雅降级返回预设模型列表", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: { message: "The requested resource was not found" } }),
    });

    const req = new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "sk-zhipu",
        presetId: "zhipu",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.fallback).toBe(true);
    expect(json.models).toContain("glm-4.5");
    expect(json.notice).toContain("未提供在线 /models 查询");
  });

  it("当未知端点返回 404 且无预设时，返回友好的中文引导而非裸 404 报错", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: { message: "The requested resource was not found" } }),
    });

    const req = new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({
        baseURL: "https://unknown-gateway.example/v1",
        apiKey: "sk-test",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("未提供在线 /models 查询接口");
  });
});
