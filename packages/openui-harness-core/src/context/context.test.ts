import { describe, it, expect } from "vitest";
import type { CoreMessage } from "ai";
import {
  ContextEngine,
  computeContextBudget,
  resolveContextWindow,
  estimateMessageTokens,
  estimateMessagesTokens,
  projectMessagesWithPruning,
  trimOrphanToolMessages,
  buildGenericSummaryPrompt,
} from "./index";

describe("harness-core: context", () => {
  it("resolves context window with bounds clamp", () => {
    expect(resolveContextWindow("gpt-4o")).toBeGreaterThanOrEqual(8192);
    expect(resolveContextWindow("unknown-huge-model", 10_000_000)).toBeLessThanOrEqual(2_097_152);
  });

  it("computes context budget correctly", () => {
    const budget = computeContextBudget(128_000, 4096, 0.25);
    expect(budget.window).toBe(128_000);
    expect(budget.retainTokens).toBe(32_000);
    expect(budget.triggerAt).toBeLessThan(budget.window);
  });

  it("estimates message tokens safely without duplicate counting", () => {
    const msgWithContent = { role: "user", content: "hello world" };
    const tokens1 = estimateMessageTokens(msgWithContent);
    expect(tokens1).toBeGreaterThan(8);

    const msgWithParts = {
      role: "assistant",
      parts: [{ type: "text", text: "hello world" }],
    };
    const tokens2 = estimateMessageTokens(msgWithParts);
    expect(tokens2).toBeGreaterThan(8);

    const total = estimateMessagesTokens([msgWithContent, msgWithParts]);
    expect(total).toBe(tokens1 + tokens2);
  });

  it("projectMessagesWithPruning leaves within-budget messages untouched", () => {
    const messages: CoreMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const budget = computeContextBudget(128_000, 4096);
    const result = projectMessagesWithPruning({ messages, budget });

    expect(result.pruned).toBe(false);
    expect(result.prunedCount).toBe(0);
    expect(result.summarizeUpToIndex).toBe(-1);
    expect(result.messages).toBe(messages);
  });

  it("projectMessagesWithPruning prunes tool results outside retain window while preserving protocol", () => {
    const budget = {
      window: 1000,
      triggerAt: 50,
      retainTokens: 30,
    };

    const messages: CoreMessage[] = [
      { role: "user", content: "query database" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "db_query", args: {} }],
      } as unknown as CoreMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "db_query",
            result: { huge: "x".repeat(500) },
          },
        ],
      } as unknown as CoreMessage,
      { role: "user", content: "latest question" },
    ];

    const result = projectMessagesWithPruning({ messages, budget });
    expect(result.pruned).toBe(true);
    expect(result.prunedCount).toBe(1);

    const toolMsg = result.messages[2] as { content: Array<{ result: string; toolCallId: string }> };
    expect(toolMsg.content[0].result).toContain("[已裁剪: db_query]");
    // Protocol intact: toolCallId and toolName preserved
    expect(toolMsg.content[0].toolCallId).toBe("c1");
  });

  it("supports isProtectedMessage to protect critical messages", () => {
    const budget = {
      window: 1000,
      triggerAt: 20,
      retainTokens: 10,
    };

    const messages: CoreMessage[] = [
      { role: "user", content: "msg 1" },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName: "protected_tool", result: "secret" }],
      } as unknown as CoreMessage,
      { role: "user", content: "msg 3" },
    ];

    const result = projectMessagesWithPruning({
      messages,
      budget,
      isProtectedMessage: (m) => {
        const text = JSON.stringify(m);
        return text.includes("protected_tool");
      },
    });

    const toolMsg = result.messages[1] as { content: Array<{ result: string }> };
    expect(toolMsg.content[0].result).toBe("secret");
  });

  it("trimOrphanToolMessages strips leading orphan tool messages and ensures user first", () => {
    const orphanMessages: CoreMessage[] = [
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "q", result: "ok" }] } as unknown as CoreMessage,
      { role: "assistant", content: "resuming" },
    ];

    const trimmed = trimOrphanToolMessages(orphanMessages);
    expect(trimmed[0].role).toBe("user"); // Prepended fallback user message
    expect(trimmed[1].role).toBe("assistant");
  });

  it("buildGenericSummaryPrompt formats instructions and guidelines cleanly", () => {
    const prompt = buildGenericSummaryPrompt({
      covered: [{ role: "user", content: "show me metrics" }],
      domainGuidelines: ["保留核心指标", "保留数据源过滤条件"],
      previousSummary: "此前已完成用户认证",
    });

    expect(prompt).toContain("保留核心指标");
    expect(prompt).toContain("此前已完成用户认证");
    expect(prompt).toContain("show me metrics");
  });

  it("ContextEngine facade wraps functions cleanly", () => {
    const engine = new ContextEngine();
    const budget = engine.computeBudget(64000);
    expect(budget.window).toBe(64000);
    const window = engine.resolveWindow("gpt-4o");
    expect(window).toBeGreaterThan(0);
  });
});
