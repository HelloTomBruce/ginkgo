/**
 * 计量精化测试（WS-12）：
 * - 12.1 tokenizer 接缝：stub 注入后 projectMessages 按 stub 计数；缺省启发式不变
 * - 12.2 js-tiktoken 真实估算（devDependency 安装态）；模型→encoding 映射
 *   （未安装回退用例见 tokenizer.missing.test.ts——vi.mock 需按文件隔离）
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CoreMessage } from "ai";
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  projectMessages,
  computeBudget,
} from "./context";
import { createTiktokenEstimator, resolveEncodingForModel } from "./tokenizer";

describe("tokenizer 接缝（12.1）", () => {
  it("stub tokenizer 注入后 projectMessages 的 estimated 按 stub 计数", () => {
    const messages: CoreMessage[] = [
      { role: "user", content: "这段文本会被 stub 计数" },
      { role: "assistant", content: "回复" },
    ];
    const budget = computeBudget(128_000, 16_384);
    // stub 计数远大于启发式：足以越过 triggerAt 触发 pruning 路径
    const heavy = { encode: (text: string) => text.length * 50 };
    const withStub = projectMessages({
      messages,
      budget,
      tokenizer: heavy,
    });
    const without = projectMessages({ messages, budget });
    expect(withStub.estimatedPromptTokens).toBeGreaterThan(
      without.estimatedPromptTokens
    );
    // estimated = max(heuristic, anchor) + overhead：stub 值应严格按 stub 公式
    const expected = messages.reduce((sum, m) => sum + estimateMessageTokens(m, heavy.encode), 0);
    expect(withStub.estimatedPromptTokens).toBe(expected);
  });

  it("不注入 tokenizer 时既有启发式行为不变", () => {
    const messages: CoreMessage[] = [{ role: "user", content: "中文内容四个词" }];
    expect(estimateMessagesTokens(messages)).toBe(
      messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
    );
  });

  it("stub 计数驱动 pruning：保留窗口外的 tool 结果被裁剪", () => {
    const messages: CoreMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: [] },
      { role: "tool", content: [{ type: "tool-result", toolName: "db", result: "x" }] as never },
      { role: "user", content: "q2" },
    ];
    // 小窗口 + 大计数：强制进入 pruning
    const budget = { window: 2000, triggerAt: 500, retainTokens: 100 };
    const projection = projectMessages({ messages, budget, tokenizer: { encode: () => 400 } });
    expect(projection.pruned).toBe(true);
    expect(projection.prunedCount).toBeGreaterThan(0);
  });
});

describe("js-tiktoken 真实估算（12.2，devDependency 安装态）", () => {
  it("createTiktokenEstimator 返回与 js-tiktoken 官方计数一致的估算", async () => {
    const estimator = await createTiktokenEstimator("cl100k_base");
    expect(estimator).toBeDefined();
    const { getEncoding } = await import("js-tiktoken");
    const official = getEncoding("cl100k_base");
    for (const sample of [
      "hello world, this is a tokenization smoke test",
      "中文文本的 token 计数同样要与官方一致",
      "mixed 中英 content 123 numbers !@#",
    ]) {
      expect(estimator!.encode(sample)).toBe(official.encode(sample).length);
    }
  });

  it("encoding 实例按名缓存：两次创建同 encoding 估算一致", async () => {
    const a = await createTiktokenEstimator("cl100k_base");
    const b = await createTiktokenEstimator("cl100k_base");
    expect(a?.encode("cache consistency probe")).toBe(
      b?.encode("cache consistency probe")
    );
  });
});

describe("模型 → encoding 映射", () => {
  it("config/model-tokenizer.json 前缀匹配最长优先；缺文件回退 cl100k_base", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokmap-"));
    const file = path.join(dir, "model-tokenizer.json");
    await fs.writeFile(
      file,
      JSON.stringify({ "gpt-4": "o200k_base", "gpt": "cl100k_base" })
    );
    expect(resolveEncodingForModel("gpt-4o-mini", file)).toBe("o200k_base");
    expect(resolveEncodingForModel("gpt-3.5-turbo", file)).toBe("cl100k_base");
    expect(resolveEncodingForModel("kimi-k2", file)).toBe("cl100k_base");
    expect(resolveEncodingForModel("kimi-k2", path.join(dir, "missing.json"))).toBe(
      "cl100k_base"
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
