// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST, GET } from "./route";

/** 薄壳冒烟：接线正确性（包 handler + 应用数据源单例）经真实路由导出验证 */
describe("POST /api/analyze 薄壳", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("无 key 请求返回合规降级流（引导「设置」）", async () => {
    const res = await POST(
      new Request("http://localhost:3006/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const text = await res.text();
    expect(text).toContain("未检测到 LLM API Key");
    expect(text).toContain("「设置」");
  });

  it("GET /api/analyze 探针：无 sessionId 或无任务返回 running/hasTask 均为 false", async () => {
    const res = await GET(new Request("http://localhost:3006/api/analyze?sessionId=sess_none"));
    expect(res.status).toBe(200);
    const data = await res.json();
    // hasTask 覆盖「客户端脱钩期间任务已后台完成」的 30s 保留窗，供重放收尾
    expect(data).toEqual({ running: false, hasTask: false });
  });

  it("POST /api/analyze 支持 action: stop 显式中止任务", async () => {
    const res = await POST(
      new Request("http://localhost:3006/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", sessionId: "sess_stop" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, stopped: true });
  });
});
