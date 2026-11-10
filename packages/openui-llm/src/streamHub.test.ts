import { describe, it, expect } from "vitest";
import { SessionStreamHub } from "./streamHub";

function makeFakeStreamResponse(chunks: string[], delayMs = 10): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": "v1",
    },
  });
}

async function collectStreamText(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("SessionStreamHub", () => {
  it("首个订阅者接收完整流数据", async () => {
    const hub = new SessionStreamHub();
    const raw = makeFakeStreamResponse(['0:"hello"\n', '0:" world"\n'], 5);

    const subResponse = hub.registerAndConsume("sess_1", raw);
    expect(hub.hasRunningTask("sess_1")).toBe(true);

    const result = await collectStreamText(subResponse);
    expect(result).toBe('0:"hello"\n0:" world"\n');
    expect(hub.hasRunningTask("sess_1")).toBe(false);
  });

  it("客户端中途刷新（创建新订阅）：重放历史 chunk 并继续接收后续 live 数据", async () => {
    const hub = new SessionStreamHub();
    const raw = makeFakeStreamResponse(
      ['0:"chunk1"\n', '0:"chunk2"\n', '0:"chunk3"\n', '0:"chunk4"\n'],
      20
    );

    const sub1 = hub.registerAndConsume("sess_reconn", raw);

    // 模拟 sub1 收到前 2 个 chunk 后断开连接（页面刷新）
    const reader1 = sub1.body!.getReader();
    const decoder = new TextDecoder();
    let text1 = "";
    const firstChunk = await reader1.read();
    text1 += decoder.decode(firstChunk.value);
    await reader1.cancel(); // 浏览器刷新，断开连接

    expect(text1).toContain('0:"chunk1"');

    // 页面刷新后重新接入（reconnect）
    expect(hub.hasRunningTask("sess_reconn")).toBe(true);
    const sub2 = hub.createResponse("sess_reconn")!;
    expect(sub2).toBeDefined();

    // sub2 应当接收到全量的 chunk（重放 + 后续 live）
    const text2 = await collectStreamText(sub2);
    expect(text2).toBe('0:"chunk1"\n0:"chunk2"\n0:"chunk3"\n0:"chunk4"\n');
  });

  it("支持显式中止任务 abortTask", async () => {
    const hub = new SessionStreamHub();
    const raw = makeFakeStreamResponse(
      ['0:"c1"\n', '0:"c2"\n', '0:"c3"\n', '0:"c4"\n'],
      50
    );

    hub.registerAndConsume("sess_abort", raw);
    expect(hub.hasRunningTask("sess_abort")).toBe(true);

    // 等待第一个 chunk 输出
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 用户在前端点击中止
    const stopped = hub.abortTask("sess_abort");
    expect(stopped).toBe(true);
    expect(hub.hasRunningTask("sess_abort")).toBe(false);
  });
});
