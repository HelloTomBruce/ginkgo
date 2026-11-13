/**
 * 推理思考流转换器：
 * 将 upstream SSE 数据流中非标准 OpenAI 字段（如 reasoning_content / reasoning / thought）
 * 映射为标准 <think>...</think> 标签包裹文本，配合 extractReasoningMiddleware 统一提取为 AI SDK 标准 reasoning 块。
 */

export function createReasoningContentTransformStream(): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder("utf-8");
  const textEncoder = new TextEncoder();
  let lineBuffer = "";
  let inReasoning = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += textDecoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split(/\r?\n/);
      // 保留未完成的最后一行在 buffer
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]") {
          if (trimmed === "data: [DONE]" && inReasoning) {
            inReasoning = false;
            const closeChunk = {
              choices: [{ index: 0, delta: { content: "</think>" }, finish_reason: null }],
            };
            controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(closeChunk)}\n\n`));
          }
          controller.enqueue(textEncoder.encode(line + "\n"));
          continue;
        }

        const dataContent = trimmed.slice(5).trim();
        if (!dataContent) {
          controller.enqueue(textEncoder.encode(line + "\n"));
          continue;
        }

        try {
          const json = JSON.parse(dataContent) as {
            choices?: Array<{
              index?: number;
              delta?: {
                content?: string | null;
                reasoning_content?: string;
                reasoning?: string;
                thought?: string;
                tool_calls?: unknown[];
                [key: string]: unknown;
              };
              finish_reason?: string | null;
              [key: string]: unknown;
            }>;
            [key: string]: unknown;
          };

          // 规范化 choices：部分第三方/非标 OpenAI 代理会遗漏 index 字段，导致 AI SDK 严格校验报错
          if (Array.isArray(json.choices)) {
            for (let i = 0; i < json.choices.length; i++) {
              const c = json.choices[i];
              if (c && typeof c === "object" && typeof c.index !== "number") {
                c.index = i;
              }
            }
          }

          const choice = json.choices?.[0];
          const delta = choice?.delta;

          if (delta) {
            const reasoning =
              delta.reasoning_content ?? delta.reasoning ?? delta.thought;

            if (typeof reasoning === "string" && reasoning.length > 0) {
              let content = "";
              if (!inReasoning) {
                inReasoning = true;
                content += "<think>";
              }
              content += reasoning;
              // 某些端点可能同时有普通 content
              if (typeof delta.content === "string" && delta.content.length > 0) {
                content += "</think>" + delta.content;
                inReasoning = false;
              }
              delta.content = content;
              delete delta.reasoning_content;
              delete delta.reasoning;
              delete delta.thought;
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(json)}\n\n`));
              continue;
            } else if (inReasoning) {
              // 已经处于 reasoning 状态，但当前 chunk 开始出现普通 content 或 tool_calls 或 finish_reason
              const hasRegularContent =
                typeof delta.content === "string" && delta.content.length > 0;
              const hasToolCalls =
                Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
              const hasFinish = choice.finish_reason != null;

              if (hasRegularContent || hasToolCalls || hasFinish) {
                inReasoning = false;
                if (hasRegularContent) {
                  delta.content = "</think>" + delta.content;
                } else {
                  // 先插入一个闭合 chunk 再发当前 chunk
                  const closeIndex =
                    typeof choice?.index === "number" ? choice.index : 0;
                  const closeChunk = {
                    ...json,
                    choices: [
                      {
                        index: closeIndex,
                        delta: { content: "</think>" },
                        finish_reason: null,
                      },
                    ],
                  };
                  controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(closeChunk)}\n\n`));
                }
              }
            }
          }
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(json)}\n\n`));
        } catch {
          controller.enqueue(textEncoder.encode(line + "\n"));
        }
      }
    },
    flush(controller) {
      if (lineBuffer.length > 0) {
        controller.enqueue(textEncoder.encode(lineBuffer));
      }
      if (inReasoning) {
        inReasoning = false;
        const closeChunk = {
          choices: [{ index: 0, delta: { content: "</think>" }, finish_reason: null }],
        };
        controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(closeChunk)}\n\n`));
      }
    },
  });
}

/**
 * 包装 fetch 函数，对 OpenAI 兼容端点的 SSE 响应自动注入 reasoning 转换流
 */
export function createReasoningFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/event-stream") && response.body) {
      const transformedBody = response.body.pipeThrough(
        createReasoningContentTransformStream()
      );
      return new Response(transformedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  };
}
