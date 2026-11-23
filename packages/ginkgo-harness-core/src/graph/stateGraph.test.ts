import { describe, expect, it } from "vitest";
import { InMemoryCheckpointer } from "./checkpointer";
import { END, START, StateGraph } from "./stateGraph";

interface TestState extends Record<string, unknown> {
  count: number;
  route?: string;
  history: string[];
  approved?: boolean;
}

describe("StateGraph", () => {
  it("执行线性流水线节点并返回最终状态", async () => {
    const graph = new StateGraph<TestState>()
      .addNode("stepA", (state) => ({
        count: state.count + 1,
        history: [...state.history, "A"],
      }))
      .addNode("stepB", (state) => ({
        count: state.count * 2,
        history: [...state.history, "B"],
      }))
      .addEdge(START, "stepA")
      .addEdge("stepA", "stepB")
      .addEdge("stepB", END);

    const app = graph.compile();
    const result = await app.invoke({ count: 1, history: [] });

    expect(result.status).toBe("completed");
    expect(result.state.count).toBe(4); // (1 + 1) * 2
    expect(result.state.history).toEqual(["A", "B"]);
    expect(result.checkpointId).toBeDefined();
  });

  it("支持根据状态进行条件路由", async () => {
    const graph = new StateGraph<TestState>()
      .addNode("evaluate", (state) => ({
        route: state.count > 5 ? "high" : "low",
      }))
      .addNode("handleHigh", (state) => ({
        history: [...state.history, "high-branch"],
      }))
      .addNode("handleLow", (state) => ({
        history: [...state.history, "low-branch"],
      }))
      .addEdge(START, "evaluate")
      .addConditionalEdge("evaluate", (state) =>
        state.route === "high" ? "handleHigh" : "handleLow"
      )
      .addEdge("handleHigh", END)
      .addEdge("handleLow", END);

    const app = graph.compile();

    const highRes = await app.invoke({ count: 10, history: [] });
    expect(highRes.state.history).toEqual(["high-branch"]);

    const lowRes = await app.invoke({ count: 2, history: [] });
    expect(lowRes.state.history).toEqual(["low-branch"]);
  });

  it("支持 Human-in-the-Loop 断点挂起并在审批后恢复执行 (before 模式)", async () => {
    const checkpointer = new InMemoryCheckpointer<TestState>();

    const graph = new StateGraph<TestState>()
      .addNode("preparePlan", (state) => ({
        history: [...state.history, "plan-prepared"],
      }))
      .addNode("executeAction", (state) => ({
        history: [...state.history, "action-executed"],
      }))
      .addEdge(START, "preparePlan")
      .addEdge("preparePlan", "executeAction")
      .addEdge("executeAction", END)
      .addBreakpoint("executeAction", {
        when: "before",
        reason: "需要人工审核高危操作",
        condition: (state) => !state.approved,
      });

    const app = graph.compile({ checkpointer });

    // 第一次执行：在 executeAction 前挂起
    const suspended = await app.invoke({
      count: 0,
      history: [],
      approved: false,
    });

    expect(suspended.status).toBe("suspended");
    expect(suspended.interrupt?.node).toBe("executeAction");
    expect(suspended.interrupt?.reason).toBe("需要人工审核高危操作");
    expect(suspended.state.history).toEqual(["plan-prepared"]);
    expect(suspended.checkpointId).toBeDefined();

    // 模拟人工审批，通过 resume 注入 approved: true
    const resumeRes = await app.resume(suspended.checkpointId!, {
      approved: true,
    });

    expect(resumeRes.status).toBe("completed");
    expect(resumeRes.state.history).toEqual([
      "plan-prepared",
      "action-executed",
    ]);
    expect(resumeRes.state.approved).toBe(true);
  });

  it("支持 after 模式的人机交互断点与恢复", async () => {
    const checkpointer = new InMemoryCheckpointer<TestState>();

    const graph = new StateGraph<TestState>()
      .addNode("generateDraft", (state) => ({
        history: [...state.history, "draft"],
      }))
      .addNode("finalize", (state) => ({
        history: [...state.history, "final"],
      }))
      .addEdge(START, "generateDraft")
      .addEdge("generateDraft", "finalize")
      .addEdge("finalize", END)
      .addBreakpoint("generateDraft", {
        when: "after",
        reason: "草稿生成完成，等待人工复核",
      });

    const app = graph.compile({ checkpointer });

    // 首次执行：完成 generateDraft 后挂起
    const res = await app.invoke({ count: 0, history: [] });
    expect(res.status).toBe("suspended");
    expect(res.state.history).toEqual(["draft"]);

    // 人工复核后 resume，继续执行 finalize
    const resumed = await app.resume(res.checkpointId!);
    expect(resumed.status).toBe("completed");
    expect(resumed.state.history).toEqual(["draft", "final"]);
  });

  it("防死循环：超过 maxSteps 时抛出明确异常", async () => {
    const graph = new StateGraph<TestState>()
      .addNode("loopNode", (state) => ({
        count: state.count + 1,
      }))
      .addEdge(START, "loopNode")
      .addEdge("loopNode", "loopNode");

    const app = graph.compile();

    await expect(
      app.invoke({ count: 0, history: [] }, { maxSteps: 10 })
    ).rejects.toThrow(/exceeded maximum step limit/);
  });

  it("支持 AbortSignal 中止图执行", async () => {
    const ac = new AbortController();
    const graph = new StateGraph<TestState>()
      .addNode("step1", () => {
        ac.abort();
        return {};
      })
      .addNode("step2", (state) => ({
        history: [...state.history, "should-not-run"],
      }))
      .addEdge(START, "step1")
      .addEdge("step1", "step2")
      .addEdge("step2", END);

    const app = graph.compile();
    const res = await app.invoke(
      { count: 0, history: [] },
      { signal: ac.signal }
    );

    expect(res.status).toBe("aborted");
    expect(res.state.history).toEqual([]);
  });
});
