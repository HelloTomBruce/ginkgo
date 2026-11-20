import { describe, it, expect, vi } from "vitest";
import {
  createTerminationTool,
  TaskLifecycleMachine,
} from "./index";

describe("harness-core: lifecycle & termination", () => {
  it("allows completed status when assertion passes", async () => {
    const onAccepted = vi.fn();
    const tool = createTerminationTool({
      assertion: () => ({ passed: true }),
      onSignalAccepted: onAccepted,
    });

    const res = (await tool.execute!(
      { status: "completed", deliverableSummary: "all done" },
      { messages: [], toolCallId: "call_1" }
    )) as Record<string, unknown>;

    expect(res.isError).toBe(false);
    expect(res.accepted).toBe(true);
    expect(onAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", deliverableSummary: "all done" })
    );
  });

  it("rejects completed status when assertion fails and returns informative error", async () => {
    const onRejected = vi.fn();
    const tool = createTerminationTool({
      assertion: () => ({ passed: false, rejectReason: "No charts or text output found" }),
      onSignalRejected: onRejected,
    });

    const res = (await tool.execute!(
      { status: "completed" },
      { messages: [], toolCallId: "call_1" }
    )) as Record<string, unknown>;

    expect(res.isError).toBe(true);
    expect(res.accepted).toBe(false);
    expect(res.message).toBe("No charts or text output found");
    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
      "No charts or text output found"
    );
  });

  it("allows non-completed statuses (insufficient_data/blocked) without assertion check", async () => {
    const assertionMock = vi.fn();
    const tool = createTerminationTool({
      assertion: assertionMock,
    });

    const res = (await tool.execute!(
      { status: "insufficient_data", missingInformation: ["date range"] },
      { messages: [], toolCallId: "call_1" }
    )) as Record<string, unknown>;

    expect(res.isError).toBe(false);
    expect(res.accepted).toBe(true);
    expect(assertionMock).not.toHaveBeenCalled();
  });

  it("TaskLifecycleMachine tracks steps, executed tools, and resolves resolutions", async () => {
    const machine = new TaskLifecycleMachine({
      assertion: (ctx) => ({
        passed: (ctx.evidence?.charCount as number) > 0,
        rejectReason: "charCount must be > 0",
      }),
      getEvidence: () => ({ charCount: 100 }),
    });

    expect(machine.stepCount).toBe(0);
    machine.recordStep();
    machine.recordStep();
    expect(machine.stepCount).toBe(2);

    machine.recordToolExecution("query_sql");
    expect(machine.executedTools).toEqual(["query_sql"]);

    // Test tool integration with machine
    const tool = machine.createTool();
    const res = (await tool.execute!(
      { status: "completed" },
      { messages: [], toolCallId: "call_1" }
    )) as Record<string, unknown>;
    expect(res.isError).toBe(false);

    const resolution = machine.resolve();
    expect(resolution.type).toBe("explicit_tool");
    expect(resolution.status).toBe("completed");
  });

  it("TaskLifecycleMachine resolves natural stop fallback when no explicit signal emitted", () => {
    const machine = new TaskLifecycleMachine();
    machine.recordStep();

    const resolution = machine.resolve("natural_stop", "Model emitted text and completed");
    expect(resolution.type).toBe("natural_stop");
    expect(resolution.status).toBe("completed");
  });
});
