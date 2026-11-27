import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { generateText } from "ai";
import { buildLanguageModel } from "./factory";

/**
 * 端到端验证：Provider 自定义请求头**真的出现在 HTTP 请求里**。
 *
 * factory.test.ts 只断言参数被传进 createOpenAI；这里起一个真实 HTTP 服务
 * 收包，证明 AI SDK 最终发出的请求带上了这些头——这是 OpenCode Go 能否
 * 正常路由的唯一判据（它要求 x-opencode-session 与自有 User-Agent）。
 */

interface Captured {
  headers: http.IncomingHttpHeaders;
  url?: string;
}

let server: http.Server;
let baseURL: string;
const captured: Captured[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    captured.push({ headers: req.headers, url: req.url });
    // 最小 OpenAI 兼容响应（generateText 需要合法结构）
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseURL = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("自定义请求头端到端", () => {
  it("请求实际带上 x-opencode-session 与自定义 User-Agent", async () => {
    captured.length = 0;
    const model = buildLanguageModel({
      model: "test-model",
      apiKey: "sk-test",
      baseURL,
      protocol: "openai",
      headers: {
        "x-opencode-session": "sess_e2e_123",
        "User-Agent": "ginkgo-agent/0.1.3",
      },
    });

    await generateText({ model, prompt: "hi" });

    expect(captured.length).toBeGreaterThan(0);
    const seen = captured[0].headers;
    expect(seen["x-opencode-session"]).toBe("sess_e2e_123");
    expect(seen["user-agent"]).toBe("ginkgo-agent/0.1.3");
  });

  it("未配置自定义头时仍带自动身份 UA，且不发 opencode 专有头", async () => {
    captured.length = 0;
    const model = buildLanguageModel({
      model: "test-model",
      apiKey: "sk-test",
      baseURL,
      protocol: "openai",
    });

    await generateText({ model, prompt: "hi" });

    const seen = captured[0].headers;
    // 身份层对所有请求生效：客户端自报身份（版本必须是真实 semver）
    expect(seen["user-agent"]).toMatch(/^ginkgo\/\d+\.\d+\.\d+ \(/);
    // 本地端点不是 opencode，不应带其专有头
    expect(seen["x-opencode-session"]).toBeUndefined();
    expect(seen["x-opencode-client"]).toBeUndefined();
  });
});
