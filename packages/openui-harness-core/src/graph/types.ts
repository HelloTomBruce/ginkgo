/**
 * 状态检查点快照（用于状态持久化与人机协同恢复）
 */
export interface Checkpoint<TState = Record<string, unknown>> {
  id: string;
  runId: string;
  sessionId: string;
  node: string;
  state: TState;
  createdAt: number;
  /** 若在该节点发生人机打断，记录打断原因与负载 */
  interrupt?: {
    reason: string;
    payload?: unknown;
  };
}

/**
 * 节点动作函数：接收当前只读状态，返回增量状态补丁
 */
export type NodeAction<TState> = (
  state: Readonly<TState>,
  signal?: AbortSignal
) => Promise<Partial<TState>> | Partial<TState>;

/**
 * 条件路由函数：根据当前状态计算下一个跳转的目标节点名称
 */
export type ConditionalRouter<TState> = (
  state: Readonly<TState>
) => string | Promise<string>;

/**
 * 状态图执行结果
 */
export interface GraphExecutionResult<TState> {
  state: TState;
  /** 执行终止原因：completed（图正常结束）| suspended（人机打断挂起）| aborted（外部中止） */
  status: "completed" | "suspended" | "aborted";
  /** 当前落定的检查点 ID */
  checkpointId?: string;
  /** 打断信息（仅当 status === "suspended" 时存在） */
  interrupt?: {
    node: string;
    reason: string;
    payload?: unknown;
  };
}
