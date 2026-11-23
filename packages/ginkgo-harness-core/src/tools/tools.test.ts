import { describe, it, expect } from "vitest";
import type { CoreTool } from "ai";
import { z } from "zod";
import {
  composeToolInterceptors,
  createTelemetryInterceptor,
  createTimeoutInterceptor,
  ToolTimeoutError,
} from "./index";
import type { RunId, TelemetrySink } from "../telemetry/telemetry";

const dummyParameters = z.object({});

describe("harness-core: tools interceptors", () => {
  it("passes through tools unmodified if interceptor list is empty", () => {
    const rawTools: Record<string, CoreTool> = {
      test: {
        description: "demo",
        parameters: dummyParameters,
        execute: async () => "ok",
      },
    };
    const wrapped = composeToolInterceptors(rawTools, []);
    expect(wrapped).toBe(rawTools);
  });

  it("chains interceptors in onion order and preserves arguments", async () => {
    const callOrder: string[] = [];

    const interceptorA = async (args: unknown, _ctx: unknown, next: (a?: unknown) => Promise<unknown>) => {
      callOrder.push("A_in");
      const res = await next(args);
      callOrder.push("A_out");
      return res;
    };

    const interceptorB = async (args: unknown, _ctx: unknown, next: (a?: unknown) => Promise<unknown>) => {
      callOrder.push("B_in");
      const res = await next(args);
      callOrder.push("B_out");
      return res;
    };

    const rawTools: Record<string, CoreTool> = {
      compute: {
        description: "add",
        parameters: dummyParameters,
        execute: async (args: unknown) => {
          callOrder.push("execute");
          return ((args as { val: number }).val) * 2;
        },
      },
    };

    const wrapped = composeToolInterceptors(rawTools, [interceptorA, interceptorB]);
    const res = await wrapped.compute.execute!({ val: 5 }, { messages: [], toolCallId: "c1" });

    expect(res).toBe(10);
    expect(callOrder).toEqual(["A_in", "B_in", "execute", "B_out", "A_out"]);
  });

  it("telemetry interceptor records duration, bytes, and ok status", async () => {
    const emittedEvents: Array<Record<string, unknown>> = [];
    const sink: TelemetrySink = {
      emit: (e) => emittedEvents.push(e as Record<string, unknown>),
    };

    const interceptor = createTelemetryInterceptor({
      telemetry: sink,
      runId: "run_test_123" as RunId,
    });

    const rawTools: Record<string, CoreTool> = {
      successTool: {
        parameters: dummyParameters,
        execute: async () => ({ hello: "world" }),
      },
      failureTool: {
        parameters: dummyParameters,
        execute: async () => {
          throw new Error("tool failed");
        },
      },
    };

    const wrapped = composeToolInterceptors(rawTools, [interceptor]);

    await wrapped.successTool.execute!({}, { messages: [], toolCallId: "c1" });
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].type).toBe("tool_result");
    expect(emittedEvents[0].ok).toBe(true);
    expect((emittedEvents[0].bytes as number)).toBeGreaterThan(0);
    expect((emittedEvents[0].durationMs as number)).toBeGreaterThanOrEqual(0);

    await expect(wrapped.failureTool.execute!({}, { messages: [], toolCallId: "c1" })).rejects.toThrow("tool failed");
    expect(emittedEvents.length).toBe(2);
    expect(emittedEvents[1].ok).toBe(false);
  });

  it("timeout interceptor throws ToolTimeoutError on slow tools", async () => {
    const interceptor = createTimeoutInterceptor(20);

    const rawTools: Record<string, CoreTool> = {
      slowTool: {
        parameters: dummyParameters,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return "slow";
        },
      },
      fastTool: {
        parameters: dummyParameters,
        execute: async () => "fast",
      },
    };

    const wrapped = composeToolInterceptors(rawTools, [interceptor]);

    const fastRes = await wrapped.fastTool.execute!({}, { messages: [], toolCallId: "c1" });
    expect(fastRes).toBe("fast");

    await expect(wrapped.slowTool.execute!({}, { messages: [], toolCallId: "c1" })).rejects.toThrow(ToolTimeoutError);
  });
});
