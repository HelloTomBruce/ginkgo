// @vitest-environment node
import { describe, expect, it } from "vitest";
import { streamText } from "ai";
import { simulateReadableStream } from "ai/test";
import { z } from "zod";
import { zodTool } from "./zodTool";

/**
 * zodTool 契约测试。核心防回归：zod@4 schema 直接传给 ai@4.3 的 tool() 时，
 * 模型侧 JSON Schema 转换会丢失参数结构（只剩 $schema 声明），模型看不到
 * 参数定义必然乱传——zodTool 必须保证模型收到完整 properties/required。
 * 这里走真实 streamText 管线（mock 模型抓 doStream 入参），不做 SDK mock。
 */
describe("zodTool", () => {
  const exampleSchema = z.object({
    path: z.string().describe("文件的相对路径"),
    startLine: z.number().int().positive().optional(),
  });

  async function captureModelVisibleTools(): Promise<{
    tools?: Array<{ name: string; parameters: unknown }>;
  }> {
    let mode: { tools?: Array<{ name: string; parameters: unknown }> } | undefined;
    const result = streamText({
      model: {
        specificationVersion: "v1" as const,
        provider: "mock",
        modelId: "mock-model",
        doStream: async (opts: { mode?: typeof mode }) => {
          mode = opts.mode;
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "response-metadata", id: "mock-id" },
                { type: "text-delta", textDelta: "ok" },
                {
                  type: "finish",
                  finishReason: "stop",
                  usage: { promptTokens: 1, completionTokens: 1 },
                },
              ],
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        },
      } as never,
      prompt: "hi",
      tools: {
        read_example: zodTool({
          description: "示例工具",
          parameters: exampleSchema,
          execute: async () => ({ ok: true }),
        }),
      },
    });
    for await (const _chunk of result.fullStream) {
      void _chunk; // 消费驱动管线
    }
    return mode ?? {};
  }

  it("模型视角:收到完整参数定义(properties/required/description),不再丢失", async () => {
    const { tools } = await captureModelVisibleTools();
    expect(tools).toHaveLength(1);
    expect(tools![0].name).toBe("read_example");
    const params = tools![0].parameters as {
      type: string;
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
    expect(params.type).toBe("object");
    expect(params.properties.path.type).toBe("string");
    expect(params.properties.path.description).toBe("文件的相对路径");
    expect(params.properties.startLine.type).toBe("integer");
    expect(params.required).toContain("path");
    expect(params.required).not.toContain("startLine");
  });

  it("校验视角:合法参数透传 execute", async () => {
    let received: unknown;
    const t = zodTool({
      description: "示例工具",
      parameters: exampleSchema,
      execute: async (args) => {
        received = args;
        return { ok: true };
      },
    });
    const result = await t.execute?.(
      { path: "a.txt", startLine: 2 },
      {} as never
    );
    expect(result).toEqual({ ok: true });
    expect(received).toEqual({ path: "a.txt", startLine: 2 });
  });

  it("校验视角:参数校验失败返回结构化错误反馈(isError),不上抛", async () => {
    const t = zodTool({
      description: "示例工具",
      parameters: exampleSchema,
      execute: async () => ({ ok: true }),
    });
    // path 缺失 + startLine 类型错
    const result = (await t.execute?.({ startLine: "x" }, {} as never)) as {
      error: string;
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.error).toContain("参数校验失败");
    expect(result.error).toContain("path");
  });
});
