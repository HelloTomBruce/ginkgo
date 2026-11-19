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
 * 包装 fetch 函数（带可选重复循环熔断）：
 * 对 OpenAI 兼容端点的 SSE 响应注入 reasoning 转换流与熔断流。
 */
export function createReasoningFetch(
  baseFetch: typeof fetch = fetch,
  repetitionGuard?: RepetitionGuardOptions
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/event-stream") && response.body) {
      const transformedBody = response.body
        .pipeThrough(createReasoningContentTransformStream())
        .pipeThrough(createRepetitionCircuitBreakerStream(repetitionGuard));
      return new Response(transformedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  };
}

/** 重复循环熔断器配置 */
export interface RepetitionGuardOptions {
  /** 连续相同行数阈值(行 trim 后 ≥6 字符才计入),缺省 15 */
  maxIdenticalLines?: number;
  /** 触发时注入到输出末尾的截断说明 */
  notice?: string;
  /** 触发回调(遥测用) */
  onCircuitBreak?: (info: { repeatedLine: string; repeats: number; totalChars: number }) => void;
}

export const REPETITION_NOTICE_DEFAULT =
  "\n\n⚠️(检测到输出进入重复循环,已自动截断。上方已产出的内容有效;建议换一种问法或拆小问题重试)";

/**
 * 重复循环熔断器(WS-5 之后的模型面第二道防御):
 * 推理模型在小步长算术/外推类内容上偶发生成退化——同一行字节级重复数百次,
 * 直到 maxOutputTokens 烧尽才被 length 截断,用户看到满屏垃圾、按量计费照付。
 *
 * 本流累积 delta.content,每次增量 ≥256 字符时对尾部 4KB 做「连续相同行」检测;
 * 触发即:注入截断说明 → 发规范 finish_reason=stop 终止分块 → [DONE] →
 * terminate 可读端(pipe 链取消上游 fetch body,provider 侧即刻停止生成)。
 * 已产出的合法内容全部保留,客户端按自然闭环收尾。
 */
export function createRepetitionCircuitBreakerStream(
  options: RepetitionGuardOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  const maxIdenticalLines = options.maxIdenticalLines ?? 15;
  const notice = options.notice ?? REPETITION_NOTICE_DEFAULT;
  const onCircuitBreak = options.onCircuitBreak;
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let lineBuffer = "";
  let content = "";
  let lastCheckedLen = 0;
  let broken = false;

  /** 尾部 4KB 内:trim 后 ≥6 字符的行,从末尾数连续相同的条数 */
  function countTrailingIdenticalLines(): { count: number; line: string } {
    const tail = content.length > 4096 ? content.slice(-4096) : content;
    const lines = tail
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length >= 6);
    if (lines.length === 0) return { count: 0, line: "" };
    const last = lines[lines.length - 1];
    let count = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] === last) count++;
      else break;
    }
    return { count, line: last };
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (broken) return; // 终止后 pipe 已断,防御性短路
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (broken) break;
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]") {
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }
        const dataContent = trimmed.slice(5).trim();
        if (!dataContent) {
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }
        let json: unknown;
        try {
          json = JSON.parse(dataContent);
        } catch {
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }
        const delta = (
          json as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          }
        )?.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          content += delta.content;
        }
        controller.enqueue(encoder.encode(line + "\n"));

        // 节流:每累计 ≥256 字符检测一次,避免每 token 全量扫描
        if (content.length - lastCheckedLen >= 256) {
          lastCheckedLen = content.length;
          const { count, line: repeatedLine } = countTrailingIdenticalLines();
          if (count >= maxIdenticalLines) {
            broken = true;
            onCircuitBreak?.({
              repeatedLine: repeatedLine.slice(0, 80),
              repeats: count,
              totalChars: content.length,
            });
            const noteChunk = {
              choices: [
                { index: 0, delta: { content: notice }, finish_reason: null },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(noteChunk)}\n\n`));
            const doneChunk = {
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            // 终止可读端:pipe 取消上游 fetch body,provider 侧即刻停止生成
            controller.terminate();
            return;
          }
        }
      }
    },
    flush(controller) {
      if (lineBuffer.length > 0) {
        controller.enqueue(encoder.encode(lineBuffer));
      }
    },
  });
}
