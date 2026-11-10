// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  createReasoningContentTransformStream,
  createReasoningFetch,
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
});
