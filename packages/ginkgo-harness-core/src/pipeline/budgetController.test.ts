import { describe, it, expect, vi } from "vitest";
import {
  ExecutionBudgetController,
} from "./budgetController";

describe("harness-core: ExecutionBudgetController", () => {
  it("tracks steps and aborts when exceeding maxSteps", () => {
    const onExceeded = vi.fn();
    const controller = new ExecutionBudgetController({
      maxSteps: 3,
      onExceeded,
    });

    expect(controller.steps).toBe(0);
    expect(controller.signal.aborted).toBe(false);

    controller.recordStep();
    controller.recordStep();
    expect(controller.recordStep().exceeded).toBe(false);

    const step4 = controller.recordStep();
    expect(step4.exceeded).toBe(true);
    expect(step4.reason).toContain("执行步数达到上限 3 步");
    expect(controller.signal.aborted).toBe(true);
    expect(onExceeded).toHaveBeenCalledWith(
      expect.stringContaining("执行步数达到上限 3 步"),
      expect.objectContaining({ steps: 4 })
    );

    controller.dispose();
  });

  it("tracks tokens and aborts when exceeding tokenBudget", () => {
    const onExceeded = vi.fn();
    const controller = new ExecutionBudgetController({
      tokenBudget: 15_000,
      onExceeded,
    });

    controller.recordUsage({ promptTokens: 5000, completionTokens: 5000 });
    expect(controller.tokens).toBe(10_000);
    expect(controller.signal.aborted).toBe(false);

    controller.recordUsage({ promptTokens: 4000, completionTokens: 2000 });
    expect(controller.tokens).toBe(16_000);
    expect(controller.isExceeded).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.exceededReason).toContain("累计消耗 16000 tokens 超出预算上限 15000");

    controller.dispose();
  });

  it("triggers timeout when timeoutMs is exceeded", async () => {
    const onExceeded = vi.fn();
    const controller = new ExecutionBudgetController({
      timeoutMs: 30,
      onExceeded,
    });

    await new Promise((r) => setTimeout(r, 60));

    expect(controller.isExceeded).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.exceededReason).toContain("耗时超过上限 30ms");

    controller.dispose();
  });
});
