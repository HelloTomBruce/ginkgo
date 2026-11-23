export type TerminationStatus = "completed" | "insufficient_data" | "blocked";

export interface TerminationSignal {
  status: TerminationStatus;
  /** 任务完成时的成果交付摘要 */
  deliverableSummary?: string;
  /** 数据不足或需要用户澄清时缺失的关键信息列表 */
  missingInformation?: string[];
  /** 任务受阻时的外部阻碍原因 */
  blockerReason?: string;
}

export interface DeliverableAssertionContext {
  status: TerminationStatus;
  signal: TerminationSignal;
  stepCount: number;
  executedTools: string[];
  /** 业务方附加的证据（如文本字数、生成的组件数量、查询记录等） */
  evidence?: Record<string, unknown>;
}

export interface DeliverableAssertionResult {
  passed: boolean;
  rejectReason?: string;
}

/**
 * 交付物断言契约：在模型声明 completed 时验证产出证据
 */
export type DeliverableAssertion = (
  ctx: DeliverableAssertionContext
) => DeliverableAssertionResult | Promise<DeliverableAssertionResult>;

export type TerminationResolutionType =
  | "explicit_tool"
  | "natural_stop"
  | "step_limit"
  | "budget_exceeded"
  | "aborted";

export interface TaskTerminationResolution {
  terminated: boolean;
  type: TerminationResolutionType;
  status: TerminationStatus | "incomplete";
  reason?: string;
  signal?: TerminationSignal;
}
