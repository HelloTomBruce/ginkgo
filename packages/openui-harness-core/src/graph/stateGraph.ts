import { randomUUID } from "node:crypto";
import type { Checkpointer } from "./checkpointer";
import { InMemoryCheckpointer } from "./checkpointer";
import type {
  Checkpoint,
  ConditionalRouter,
  GraphExecutionResult,
  NodeAction,
} from "./types";

export const START = "__start__";
export const END = "__end__";

export interface BreakpointRule<TState> {
  when: "before" | "after";
  condition?: (
    state: Readonly<TState>
  ) => { interrupt: boolean; reason?: string; payload?: unknown } | boolean;
  defaultReason?: string;
}

export interface StateGraphOptions<TState> {
  checkpointer?: Checkpointer<TState>;
}

export interface RunGraphOptions {
  sessionId?: string;
  runId?: string;
  signal?: AbortSignal;
  maxSteps?: number;
}

/**
 * 状态图构建器（对标 LangGraph StateGraph）
 * 支持有向图拓扑、条件分支路由、断点打断 (Human-in-the-Loop) 与检查点状态恢复。
 */
export class StateGraph<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly nodes = new Map<string, NodeAction<TState>>();
  private readonly edges = new Map<string, string>();
  private readonly conditionalEdges = new Map<string, ConditionalRouter<TState>>();
  private readonly breakpoints = new Map<string, BreakpointRule<TState>>();

  /**
   * 注册图节点
   */
  addNode(name: string, action: NodeAction<TState>): this {
    if (name === START || name === END) {
      throw new Error(`Reserved node name cannot be used: ${name}`);
    }
    this.nodes.set(name, action);
    return this;
  }

  /**
   * 注册普通静态边
   */
  addEdge(from: string, to: string): this {
    if (from !== START && !this.nodes.has(from)) {
      throw new Error(`Source node does not exist: ${from}`);
    }
    if (to !== END && !this.nodes.has(to)) {
      throw new Error(`Target node does not exist: ${to}`);
    }
    this.edges.set(from, to);
    return this;
  }

  /**
   * 注册条件路由边
   */
  addConditionalEdge(from: string, router: ConditionalRouter<TState>): this {
    if (from !== START && !this.nodes.has(from)) {
      throw new Error(`Source node does not exist: ${from}`);
    }
    this.conditionalEdges.set(from, router);
    return this;
  }

  /**
   * 在特定节点设置人机交互断点 (Human-in-the-Loop)
   */
  addBreakpoint(
    node: string,
    options?:
      | string
      | {
          when?: "before" | "after";
          reason?: string;
          condition?: (
            state: Readonly<TState>
          ) =>
            | { interrupt: boolean; reason?: string; payload?: unknown }
            | boolean;
        }
  ): this {
    if (!this.nodes.has(node)) {
      throw new Error(`Cannot set breakpoint on nonexistent node: ${node}`);
    }

    if (typeof options === "string") {
      this.breakpoints.set(node, {
        when: "before",
        defaultReason: options,
      });
    } else {
      this.breakpoints.set(node, {
        when: options?.when ?? "before",
        defaultReason: options?.reason ?? "Breakpoint encountered",
        condition: options?.condition,
      });
    }
    return this;
  }

  /**
   * 编译为可执行的状态图实例
   */
  compile(options?: StateGraphOptions<TState>): CompiledStateGraph<TState> {
    return new CompiledStateGraph<TState>(
      new Map(this.nodes),
      new Map(this.edges),
      new Map(this.conditionalEdges),
      new Map(this.breakpoints),
      options?.checkpointer ?? new InMemoryCheckpointer<TState>()
    );
  }
}

/**
 * 已编译的状态图执行引擎
 */
export class CompiledStateGraph<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(
    private readonly nodes: Map<string, NodeAction<TState>>,
    private readonly edges: Map<string, string>,
    private readonly conditionalEdges: Map<
      string,
      ConditionalRouter<TState>
    >,
    private readonly breakpoints: Map<string, BreakpointRule<TState>>,
    private readonly checkpointer: Checkpointer<TState>
  ) {}

  /**
   * 从头开始调用执行图
   */
  async invoke(
    initialState: TState,
    options?: RunGraphOptions
  ): Promise<GraphExecutionResult<TState>> {
    const runId = options?.runId ?? `run-${randomUUID()}`;
    const sessionId = options?.sessionId ?? `sess-${randomUUID()}`;

    // 确定入口节点
    const startNode = this.edges.get(START);
    if (!startNode) {
      throw new Error("No START edge configured in graph. Call addEdge(START, 'firstNode') first.");
    }

    return this.runFrom(startNode, initialState, runId, sessionId, false, options);
  }

  /**
   * 从指定检查点唤醒并恢复执行 (Human-in-the-Loop Resume)
   */
  async resume(
    checkpointId: string,
    statePatch?: Partial<TState>,
    options?: RunGraphOptions
  ): Promise<GraphExecutionResult<TState>> {
    const checkpoint = await this.checkpointer.load(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const mergedState: TState = {
      ...checkpoint.state,
      ...(statePatch ?? {}),
    };

    const bp = this.breakpoints.get(checkpoint.node);
    const resumeMode = bp?.when === "after" ? "skipToNext" : "resumeAction";

    if (resumeMode === "skipToNext") {
      const nextNode = await this.getNextNode(checkpoint.node, mergedState);
      if (!nextNode || nextNode === END) {
        return {
          state: mergedState,
          status: "completed",
          checkpointId,
        };
      }
      return this.runFrom(
        nextNode,
        mergedState,
        options?.runId ?? checkpoint.runId,
        options?.sessionId ?? checkpoint.sessionId,
        false,
        options
      );
    }

    // before 模式打断，恢复时直接执行该节点的 action，跳过 before 断点判断
    return this.runFrom(
      checkpoint.node,
      mergedState,
      options?.runId ?? checkpoint.runId,
      options?.sessionId ?? checkpoint.sessionId,
      true, // skipBeforeBreakpoint
      options
    );
  }

  /**
   * 执行循环
   */
  private async runFrom(
    currentNode: string,
    initialState: TState,
    runId: string,
    sessionId: string,
    skipBeforeBreakpoint: boolean,
    options?: RunGraphOptions
  ): Promise<GraphExecutionResult<TState>> {
    let state = { ...initialState };
    let nodeName: string | undefined = currentNode;
    let steps = 0;
    const maxSteps = options?.maxSteps ?? 50;

    let bypassNextBeforeBp = skipBeforeBreakpoint;

    while (nodeName && nodeName !== END) {
      if (options?.signal?.aborted) {
        return {
          state,
          status: "aborted",
        };
      }

      if (++steps > maxSteps) {
        throw new Error(
          `Graph execution exceeded maximum step limit of ${maxSteps}. Check for cyclic dependencies.`
        );
      }

      const bp = this.breakpoints.get(nodeName);

      // 1. Before 断点检查
      if (bp && bp.when === "before" && !bypassNextBeforeBp) {
        const hit = this.checkBreakpoint(bp, state);
        if (hit.interrupt) {
          const cp: Checkpoint<TState> = {
            id: `cp-${randomUUID()}`,
            runId,
            sessionId,
            node: nodeName,
            state,
            createdAt: Date.now(),
            interrupt: {
              reason: hit.reason,
              payload: hit.payload,
            },
          };
          await this.checkpointer.save(cp);
          return {
            state,
            status: "suspended",
            checkpointId: cp.id,
            interrupt: {
              node: nodeName,
              reason: hit.reason,
              payload: hit.payload,
            },
          };
        }
      }
      bypassNextBeforeBp = false;

      // 2. 执行当前节点 Action
      const action = this.nodes.get(nodeName);
      if (!action) {
        throw new Error(`Node action not found for: ${nodeName}`);
      }

      const patch = await action(state, options?.signal);
      state = { ...state, ...(patch ?? {}) };

      // 3. After 断点检查
      if (bp && bp.when === "after") {
        const hit = this.checkBreakpoint(bp, state);
        if (hit.interrupt) {
          const cp: Checkpoint<TState> = {
            id: `cp-${randomUUID()}`,
            runId,
            sessionId,
            node: nodeName,
            state,
            createdAt: Date.now(),
            interrupt: {
              reason: hit.reason,
              payload: hit.payload,
            },
          };
          await this.checkpointer.save(cp);
          return {
            state,
            status: "suspended",
            checkpointId: cp.id,
            interrupt: {
              node: nodeName,
              reason: hit.reason,
              payload: hit.payload,
            },
          };
        }
      }

      // 4. 寻址下一节点
      nodeName = await this.getNextNode(nodeName, state);
    }

    // 完成落定最终检查点
    const finalCp: Checkpoint<TState> = {
      id: `cp-${randomUUID()}`,
      runId,
      sessionId,
      node: END,
      state,
      createdAt: Date.now(),
    };
    await this.checkpointer.save(finalCp);

    return {
      state,
      status: "completed",
      checkpointId: finalCp.id,
    };
  }

  private async getNextNode(
    currentNode: string,
    state: Readonly<TState>
  ): Promise<string | undefined> {
    if (this.conditionalEdges.has(currentNode)) {
      const router = this.conditionalEdges.get(currentNode)!;
      return router(state);
    }
    return this.edges.get(currentNode);
  }

  private checkBreakpoint(
    bp: BreakpointRule<TState>,
    state: Readonly<TState>
  ): { interrupt: boolean; reason: string; payload?: unknown } {
    if (!bp.condition) {
      return { interrupt: true, reason: bp.defaultReason ?? "Breakpoint hit" };
    }
    const res = bp.condition(state);
    if (typeof res === "boolean") {
      return {
        interrupt: res,
        reason: bp.defaultReason ?? "Breakpoint condition satisfied",
      };
    }
    return {
      interrupt: res.interrupt,
      reason: res.reason ?? bp.defaultReason ?? "Breakpoint condition satisfied",
      payload: res.payload,
    };
  }
}
