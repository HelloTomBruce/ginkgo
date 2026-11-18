// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnalyzeHandler } from "./handler";
import { SessionStreamHub } from "./streamHub";
import type { AuthContext } from "./handler";
import type { HarnessEvent } from "./telemetry";
import type { DatasourceManager, McpToolBinding } from "@openui-analytics/datasources";
import { streamText } from "ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    generateText: vi.fn(),
  };
});

/** 依赖注入接缝：真 manager 读临时配置文件，仅 tools（IO）覆写为 mock */
async function makeFakeManager(): Promise<DatasourceManager> {
  const { createDatasourceManager } = await import(
    "@openui-analytics/datasources"
  );
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "llm-auth-")),
    "datasources.json"
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      sources: [
        {
          id: "jira",
          name: "Jira MCP",
          kind: "http-mcp",
          url: "http://10.0.0.1:6000/mcp",
          token: "",
          enabled: true,
        },
      ],
    })
  );
  const real = createDatasourceManager({ configPath: file });
  const tools = vi.fn(async (): Promise<McpToolBinding[]> => []);
  return { ...real, tools };
}

/** 贴近真实 SDK 契约的 streamText mock：字节经 toDataStream 交付 */
function streamResult(chunks: string[]): ReturnType<typeof streamText> {
  return {
    toDataStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
  } as unknown as ReturnType<typeof streamText>;
}

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost:3006/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** 从请求头取测试租户（authenticate 不读 body——body 只能被消费一次） */
function tenantAuth(tenants: Record<string, AuthContext | null>) {
  return async (req: Request): Promise<AuthContext | null> => {
    const t = req.headers.get("x-test-tenant") ?? "anon";
    return tenants[t] ?? null;
  };
}

function makeSink() {
  const events: HarnessEvent[] = [];
  return { events, sink: { emit: (e: HarnessEvent) => events.push(e) } };
}

describe("WS-10 hub 租户命名空间（10.1）", () => {
  it("同 sessionId 不同租户互不命中（注册/探测/中止全隔离）", async () => {
    const hub = new SessionStreamHub();
    const raw = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('0:"a"\n'));
          // 不 close：任务保持 running
        },
      })
    );

    await hub.registerAndConsume("sess_1", raw, { tenantId: "tenant-a" });
    expect(await hub.hasRunningTask("sess_1", "tenant-a")).toBe(true);

    // 租户 B 带同 sessionId：视为无任务
    expect(await hub.hasTask("sess_1", "tenant-b")).toBe(false);
    expect(await hub.hasRunningTask("sess_1", "tenant-b")).toBe(false);
    expect(await hub.getTask("sess_1", "tenant-b")).toBeUndefined();
    expect(await hub.createResponse("sess_1", "tenant-b")).toBeNull();
    expect(await hub.abortTask("sess_1", "user", "tenant-b")).toBe(false);

    // A 的任务不受影响，仍在 running
    expect(await hub.hasRunningTask("sess_1", "tenant-a")).toBe(true);
    expect(await hub.abortTask("sess_1", "user", "tenant-a")).toBe(true);
    expect(await hub.hasRunningTask("sess_1", "tenant-a")).toBe(false);
  });

  it("缺省 tenantId 即匿名租户 \"anon\"：与不传 tenantId 完全等价", async () => {
    const hub = new SessionStreamHub();
    const stuck = new Response(new ReadableStream<Uint8Array>({ start() {} }));
    await hub.registerAndConsume("sess_def", stuck);

    expect(await hub.hasRunningTask("sess_def")).toBe(true);
    expect(await hub.hasRunningTask("sess_def", "anon")).toBe(true);
    expect(await hub.hasTask("sess_def", "anon")).toBe(true);
    // 显式 anon 与非 anon 租户互不串
    expect(await hub.hasRunningTask("sess_def", "tenant-x")).toBe(false);
  });
});

describe("WS-10 authenticate 钩子与 401（10.2）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.mocked(streamText).mockReturnValue(streamResult(['0:"ok"\n']));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("authenticate 返回 null → 401 且不再进入分析", async () => {
    const { events, sink } = makeSink();
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      telemetry: sink,
      authenticate: async () => null,
    });

    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(401);
    expect(streamText).not.toHaveBeenCalled();
    // 不产生 run_start（守卫未通过）
    expect(events.filter((e) => e.type === "run_start")).toHaveLength(0);
  });

  it("AuthContext → run_start 带 principal 与 tenantId", async () => {
    const { events, sink } = makeSink();
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      telemetry: sink,
      authenticate: async () => ({ principal: "key-42", tenantId: "tenant-a" }),
    });

    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    const runStart = events.find((e) => e.type === "run_start");
    expect(runStart).toMatchObject({
      type: "run_start",
      principal: "key-42",
      tenantId: "tenant-a",
    });
  });

  it("未注入 authenticate → run_start 不带 principal/tenantId（行为与现状一致）", async () => {
    const { events, sink } = makeSink();
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      telemetry: sink,
    });

    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    const runStart = events.find((e) => e.type === "run_start") as
      | Record<string, unknown>
      | undefined;
    expect(runStart).toBeDefined();
    expect(runStart).not.toHaveProperty("principal");
    expect(runStart).not.toHaveProperty("tenantId");
  });

  it("tenantId 缺省时以 principal 作为租户命名空间", async () => {
    const { events, sink } = makeSink();
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      telemetry: sink,
      authenticate: async () => ({ principal: "user-7" }),
    });

    await POST(makeRequest({ messages: [], apiKey: "k", sessionId: "sess_t" }));
    const runStart = events.find((e) => e.type === "run_start");
    expect(runStart).toMatchObject({ tenantId: "user-7" });
    // principal 缺省回退：会话任务落在 user-7 命名空间
    expect(await POST.isSessionRunning("sess_t", "user-7")).toBe(true);
    expect(await POST.isSessionRunning("sess_t", "anon")).toBe(false);
  });
});

describe("WS-10 跨租户重接防护（10.3）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("租户 B 带 A 的 sessionId reconnect/stop 均不命中 A 的任务", async () => {
    let finishStream: (() => void) | undefined;
    vi.mocked(streamText).mockReturnValue({
      toDataStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('0:"chunk1"\n'));
            void new Promise<void>((resolve) => {
              finishStream = resolve;
            }).then(() => {
              controller.enqueue(new TextEncoder().encode('0:"chunk2"\n'));
              controller.close();
            });
          },
        }),
    } as unknown as ReturnType<typeof streamText>);

    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      authenticate: tenantAuth({
        "tenant-a": { principal: "a", tenantId: "tenant-a" },
        "tenant-b": { principal: "b", tenantId: "tenant-b" },
      }),
    });

    // 租户 A 启动任务
    const resA = await POST(
      makeRequest(
        { messages: [], apiKey: "k", sessionId: "sess_shared" },
        { "x-test-tenant": "tenant-a" }
      )
    );
    expect(resA.status).toBe(200);
    expect(await POST.isSessionRunning("sess_shared", "tenant-a")).toBe(true);
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);

    // 租户 B 带同 sessionId reconnect：不命中 A 的任务，只能作为新任务启动
    const resB = await POST(
      makeRequest(
        { messages: [], apiKey: "k", sessionId: "sess_shared", reconnect: true },
        { "x-test-tenant": "tenant-b" }
      )
    );
    expect(resB.status).toBe(200);
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    // A 的任务仍在 running，未被重连顶替
    expect(await POST.isSessionRunning("sess_shared", "tenant-a")).toBe(true);

    // 租户 B 的 stop：只停自己的任务
    const stopB = await POST(
      makeRequest(
        { action: "stop", sessionId: "sess_shared" },
        { "x-test-tenant": "tenant-b" }
      )
    );
    expect(((await stopB.json()) as { stopped: boolean }).stopped).toBe(true);
    expect(await POST.isSessionRunning("sess_shared", "tenant-b")).toBe(false);
    expect(await POST.isSessionRunning("sess_shared", "tenant-a")).toBe(true);

    // 收尾：放行两个在途流
    finishStream!();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 租户 A 的 stop 仍可命中自己的任务
    const stopA = await POST(
      makeRequest(
        { action: "stop", sessionId: "sess_shared" },
        { "x-test-tenant": "tenant-a" }
      )
    );
    expect(((await stopA.json()) as { stopped: boolean }).stopped).toBe(true);
    expect(await POST.isSessionRunning("sess_shared", "tenant-a")).toBe(false);
  });
});

describe("WS-10 env 凭证借用开关（10.4）", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.mocked(streamText).mockReturnValue(streamResult(['0:"ok"\n']));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("allowEnvCredentials=false 且无请求体 key：跳过 env 凭证，走 NO_API_KEY 降级流", async () => {
    process.env.OPENAI_API_KEY = "platform-secret-key";
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      authenticate: async () => ({
        principal: "tenant-x",
        claims: { allowEnvCredentials: false },
      }),
    });

    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const text = await res.text();
    expect(text).toContain("未检测到 LLM API Key");
    // 平台 env 凭证未被借用
    expect(streamText).not.toHaveBeenCalled();
  });

  it("allowEnvCredentials=false 但请求体自带 key：正常分析", async () => {
    process.env.OPENAI_API_KEY = "platform-secret-key";
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      authenticate: async () => ({
        principal: "tenant-x",
        claims: { allowEnvCredentials: false },
      }),
    });

    const res = await POST(makeRequest({ messages: [], apiKey: "tenant-own-key" }));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("未声明 allowEnvCredentials：env 凭证回退保持现状", async () => {
    process.env.OPENAI_API_KEY = "platform-secret-key";
    const POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      authenticate: async () => ({ principal: "tenant-x" }),
    });

    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});
