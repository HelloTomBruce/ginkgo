// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { CoreTool } from "ai";
import {
  MAX_IDENTICAL_FAILURES,
  createToolDeadlockState,
  stableStringify,
  computeToolCallSignature,
  withDeadlockGuard,
} from "./deadlockGuard";

/** 构造一个恒败工具（返回 toolFailure 形态结果，不抛异常） */
function failingTool(): { tool: CoreTool; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async () => ({ success: false as const, error: "[flaky_tool] boom", isError: true as const }));
  return {
    spy,
    tool: {
      description: "test",
      parameters: { type: "object", properties: {}, additionalProperties: true },
      execute: spy as never,
    },
  };
}

describe("stableStringify / computeToolCallSignature", () => {
  it("同参异序产生相同序列化与签名（key 顺序无关）", () => {
    const a = { sql: "SELECT 1", params: [1, 2] };
    const b = { params: [1, 2], sql: "SELECT 1" };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(computeToolCallSignature("execute_sql", a)).toBe(
      computeToolCallSignature("execute_sql", b)
    );
  });

  it("嵌套对象的 key 也参与排序；undefined 值字段不参与", () => {
    const a = { outer: { y: 1, x: 2 }, skip: undefined };
    const b = { outer: { x: 2, y: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("不同参数/不同工具名产生不同签名", () => {
    expect(computeToolCallSignature("t", { a: 1 })).not.toBe(
      computeToolCallSignature("t", { a: 2 })
    );
    expect(computeToolCallSignature("t", { a: 1 })).not.toBe(
      computeToolCallSignature("u", { a: 1 })
    );
  });
});

describe("withDeadlockGuard", () => {
  const optionsBase = { toolCallId: "call_1", messages: [] as never[] };

  it("同签名失败达到阈值后，第 MAX+1 次调用被拦截且不再执行真实 execute", async () => {
    const { spy, tool } = failingTool();
    const state = createToolDeadlockState();
    const wrapped = withDeadlockGuard({ flaky_tool: tool }, state);
    const args = { sql: "SELECT * FROM orders" };

    // 前两次真实执行并失败
    await wrapped.flaky_tool.execute!(args, optionsBase);
    await wrapped.flaky_tool.execute!(args, optionsBase);
    expect(spy).toHaveBeenCalledTimes(2);

    // 第三次同参调用被熔断拦截
    const fused = await wrapped.flaky_tool.execute!(args, optionsBase);
    expect(spy).toHaveBeenCalledTimes(2); // 不再增长
    expect((fused as { isError: boolean }).isError).toBe(true);
    expect(String((fused as { error: string }).error)).toContain("死锁熔断");
    expect(String((fused as { error: string }).error)).toContain("finish_task");
  });

  it("参数演变（异序不算演变）重新计数，不同参数互不影响", async () => {
    const { spy, tool } = failingTool();
    const state = createToolDeadlockState();
    const wrapped = withDeadlockGuard({ flaky_tool: tool }, state);

    await wrapped.flaky_tool.execute!({ q: "SELECT 1" }, optionsBase);
    // 同参异序：仍是同一签名 → 计数到 2
    await wrapped.flaky_tool.execute!({ q: "SELECT 1" }, optionsBase);
    // 参数真正变化：独立签名，正常执行
    const r = await wrapped.flaky_tool.execute!({ q: "SELECT 2" }, optionsBase);
    expect(spy).toHaveBeenCalledTimes(3);
    expect((r as { isError: boolean }).isError).toBe(true);
  });

  it("成功清除该签名计数（失败→成功→失败，重新从 0 计）", async () => {
    const state = createToolDeadlockState();
    let calls = 0;
    const tool: CoreTool = {
      description: "test",
      parameters: { type: "object", properties: {}, additionalProperties: true },
      execute: (async () => {
        calls += 1;
        return calls % 2 === 1
          ? { success: false as const, error: "transient", isError: true as const }
          : { ok: true };
      }) as never,
    };
    const wrapped = withDeadlockGuard({ t: tool }, state);
    const args = { q: 1 };

    await wrapped.t.execute!(args, optionsBase); // 失败 count=1
    await wrapped.t.execute!(args, optionsBase); // 成功 → 清零
    const r = await wrapped.t.execute!(args, optionsBase); // 失败 count=1（重新计）
    expect((r as { isError: boolean }).isError).toBe(true);
    expect(calls).toBe(3); // 三次都真实执行，未被熔断
  });

  it("execute 抛出的异常原样透传（AbortError 语义不可吞）", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const tool: CoreTool = {
      description: "test",
      parameters: { type: "object", properties: {}, additionalProperties: true },
      execute: (async () => {
        throw abortErr;
      }) as never,
    };
    const wrapped = withDeadlockGuard({ t: tool }, createToolDeadlockState());
    await expect(wrapped.t.execute!({}, optionsBase)).rejects.toBe(abortErr);
  });

  it("无 execute 的声明式工具原样透传", () => {
    const declarative = { description: "d", parameters: {} } as unknown as CoreTool;
    const wrapped = withDeadlockGuard({ declarative }, createToolDeadlockState());
    expect(wrapped.declarative).toBe(declarative);
  });

  it("达到阈值时触发 onFuse 回调并携带工具名与失败次数", async () => {
    const { tool } = failingTool();
    const onFuse = vi.fn();
    const wrapped = withDeadlockGuard({ t: tool }, createToolDeadlockState(), { onFuse });
    const args = { a: 1 };
    const opts = { toolCallId: "c", messages: [] as never[] };
    await wrapped.t.execute!(args, opts);
    await wrapped.t.execute!(args, opts);
    expect(onFuse).not.toHaveBeenCalled();
    await wrapped.t.execute!(args, opts);
    expect(onFuse).toHaveBeenCalledWith({ toolName: "t", failureCount: MAX_IDENTICAL_FAILURES });
  });
});
