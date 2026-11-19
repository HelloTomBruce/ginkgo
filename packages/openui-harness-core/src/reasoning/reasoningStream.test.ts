// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  createReasoningContentTransformStream,
  createReasoningFetch,
  createRepetitionCircuitBreakerStream,
} from "./reasoningStream";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
}

describe("createReasoningContentTransformStream", () => {
  it("将包含 reasoning_content 的流转换为带 <think> 标签的 content 流", async () => {
    const sseInput = [
      'data: {"id":"1","choices":[{"delta":{"role":"assistant","reasoning_content":"思考步骤1"},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"delta":{"reasoning_content":"步骤2"},"finish_reason":null}]}\n\n',
      'data: {"id":"3","choices":[{"delta":{"content":"正式回答"},"finish_reason":null}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const transformed = makeStream(sseInput).pipeThrough(
      createReasoningContentTransformStream()
    );
    const output = await readStream(transformed);

    expect(output).toContain("<think>思考步骤1");
    expect(output).toContain("步骤2");
    expect(output).toContain("</think>正式回答");
    expect(output).toContain("data: [DONE]");
  });

  it("当思考直接遇到 tool_calls 时，在 tool_calls 之前闭合 </think>", async () => {
    const sseInput = [
      'data: {"id":"1","choices":[{"delta":{"reasoning_content":"需要查表"},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"delta":{"tool_calls":[{"function":{"name":"query"}}]},"finish_reason":null}]}\n\n',
    ];

    const transformed = makeStream(sseInput).pipeThrough(
      createReasoningContentTransformStream()
    );
    const output = await readStream(transformed);

    expect(output).toContain("<think>需要查表");
    expect(output).toContain("</think>");
    expect(output).toContain('"tool_calls"');
  });

  it("无 reasoning_content 的普通流原样透传", async () => {
    const sseInput = [
      'data: {"id":"1","choices":[{"delta":{"content":"普通文字"},"finish_reason":null}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const transformed = makeStream(sseInput).pipeThrough(
      createReasoningContentTransformStream()
    );
    const output = await readStream(transformed);

    expect(output).toContain("普通文字");
    expect(output).not.toContain("<think>");
    expect(output).not.toContain("</think>");
  });

  it("createReasoningFetch 自动拦截 text/event-stream 响应", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        makeStream([
          'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }
      );

    const wrappedFetch = createReasoningFetch(fakeFetch);
    const res = await wrappedFetch("https://api.example.com/chat/completions");
    const text = await res.text();

    expect(text).toContain("<think>思考中");
    expect(text).toContain("</think>");
  });

  it("自动补齐 choices 中的 index 字段，且生成的闭合 chunk 包含合法的 index: 0", async () => {
    // 模拟非标 SSE chunk（如智谱 GLM 或缺失 index 的端点）
    const sseInput = [
      'data: {"id":"1","choices":[{"delta":{"reasoning_content":"推理过程"}}]}\n\n',
      'data: {"id":"2","choices":[{"delta":{"content":"正式回答"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const transformed = makeStream(sseInput).pipeThrough(
      createReasoningContentTransformStream()
    );
    const output = await readStream(transformed);

    const lines = output
      .split("\n\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("data:") && l !== "data: [DONE]");

    for (const line of lines) {
      const parsed = JSON.parse(line.slice(5).trim());
      expect(Array.isArray(parsed.choices)).toBe(true);
      for (const choice of parsed.choices) {
        expect(typeof choice.index).toBe("number");
      }
    }
  });
});

function contentDelta(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

describe("重复循环熔断器", () => {
  it("同一行连续重复 ≥15 次:注入截断说明并以规范 stop/[DONE] 终止,回调上报", async () => {
    const onCircuitBreak = vi.fn();
    const loopLine = "418,000 × 1.1531 = 482,xxx\n";
    const chunks = [
      contentDelta("## 增长预测\n\n"),
      ...Array.from({ length: 20 }, () => contentDelta(loopLine)),
      contentDelta("后续内容(真实场景不会到达)"),
      "data: [DONE]\n\n",
    ];
    const out = await readStream(
      makeStream(chunks).pipeThrough(
        createRepetitionCircuitBreakerStream({ onCircuitBreak })
      )
    );

    expect(onCircuitBreak).toHaveBeenCalledTimes(1);
    expect(onCircuitBreak.mock.calls[0][0].repeats).toBeGreaterThanOrEqual(15);
    expect(out).toContain("检测到输出进入重复循环");
    expect(out).toContain('"finish_reason":"stop"');
    expect(out).toContain("data: [DONE]");
    // 终止后不再有内容分块
    expect(out).not.toContain("后续内容");
    // 截断说明在最后一个 content 分块中
    const lastContentIdx = out.lastIndexOf("检测到输出进入重复循环");
    expect(out.indexOf("data: [DONE]")).toBeGreaterThan(lastContentIdx);
  });

  it("合法表格行(内容各不相同)全部透传,不误伤", async () => {
    const rows = Array.from(
      { length: 30 },
      (_, i) => contentDelta(`| 2025-${String(i % 12 + 1).padStart(2, "0")} | ${1000 + i * 7} |\n`)
    );
    const chunks = [
      contentDelta("| 月份 | 收入 |\n|---|---|\n"),
      ...rows,
      "data: [DONE]\n\n",
    ];
    const out = await readStream(
      makeStream(chunks).pipeThrough(createRepetitionCircuitBreakerStream())
    );
    // out 是 SSE 字节流:断言解码后的 content 子串(JSON 内原文)存在
    expect(out).not.toContain("重复循环");
    expect(out).toContain("2025-06");
    expect(out).toContain("1203");
    expect(out).toContain("data: [DONE]");
  });

  it("短行(<6 字符)不计入重复判定", async () => {
    const chunks = [
      ...Array.from({ length: 30 }, () => contentDelta("——\n")),
      "data: [DONE]\n\n",
    ];
    const out = await readStream(
      makeStream(chunks).pipeThrough(createRepetitionCircuitBreakerStream())
    );
    expect(out).not.toContain("重复循环");
    expect((out.match(/——/g) ?? []).length).toBeGreaterThanOrEqual(30);
  });

  it("createReasoningFetch 组合管道:reasoning 映射 + 熔断协同工作", async () => {
    const onCircuitBreak = vi.fn();
    const loopLine = "monthly = prev * 1.1531, forever and ever\n";
    const sseChunks = [
      'data: {"choices":[{"delta":{"reasoning_content":"先推理"}}]}\n\n',
      ...Array.from({ length: 20 }, () => contentDelta(loopLine)),
      "data: [DONE]\n\n",
    ];
    const fakeFetch = vi.fn(async () =>
      new Response(makeStream(sseChunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    const wrappedFetch = createReasoningFetch(fakeFetch as unknown as typeof fetch, {
      onCircuitBreak,
    });
    const res = await wrappedFetch("https://api.example.com/chat/completions");
    const text = await res.text();

    expect(onCircuitBreak).toHaveBeenCalledTimes(1);
    expect(text).toContain("<think>先推理");
    expect(text).toContain("</think>");
    expect(text).toContain("检测到输出进入重复循环");
  });
});
