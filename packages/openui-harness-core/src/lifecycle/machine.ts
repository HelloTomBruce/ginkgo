import type { CoreTool } from "ai";
import type {
  DeliverableAssertion,
  TaskTerminationResolution,
  TerminationResolutionType,
  TerminationSignal,
} from "./types";
import { createTerminationTool } from "./terminationTool";

export interface TaskLifecycleMachineOptions {
  assertion?: DeliverableAssertion;
  toolName?: string;
  getEvidence?: () => Record<string, unknown>;
  onSignalAccepted?: (signal: TerminationSignal) => void;
  onSignalRejected?: (signal: TerminationSignal, reason: string) => void;
}

/**
 * 任务生命周期与双重终态状态机
 * 管理 Step 计数、工具执行追踪、显式终态声明与隐式停机决议。
 */
export class TaskLifecycleMachine {
  private _stepCount: number = 0;
  private _executedTools: string[] = [];
  private _explicitSignal?: TerminationSignal;

  constructor(public readonly options: TaskLifecycleMachineOptions = {}) {}

  get stepCount(): number {
    return this._stepCount;
  }

  get executedTools(): readonly string[] {
    return this._executedTools;
  }

  get explicitSignal(): TerminationSignal | undefined {
    return this._explicitSignal;
  }

  recordStep(): number {
    this._stepCount++;
    return this._stepCount;
  }

  recordToolExecution(toolName: string): void {
    this._executedTools.push(toolName);
  }

  /**
   * 创建绑定的终态声明工具（如 finish_task）
   */
  createTool(): CoreTool {
    return createTerminationTool({
      toolName: this.options.toolName,
      assertion: this.options.assertion,
      getAssertionContext: () => ({
        stepCount: this._stepCount,
        executedTools: [...this._executedTools],
        evidence: this.options.getEvidence?.(),
      }),
      onSignalAccepted: (sig) => {
        this._explicitSignal = sig;
        this.options.onSignalAccepted?.(sig);
      },
      onSignalRejected: (sig, reason) => {
        this.options.onSignalRejected?.(sig, reason);
      },
    });
  }

  /**
   * 综合显式信号与执行结果，裁定最终终态决议
   */
  resolve(fallbackType?: TerminationResolutionType, reason?: string): TaskTerminationResolution {
    if (this._explicitSignal) {
      return {
        terminated: true,
        type: "explicit_tool",
        status: this._explicitSignal.status,
        reason: this._explicitSignal.deliverableSummary ?? reason,
        signal: this._explicitSignal,
      };
    }

    const type = fallbackType ?? "natural_stop";
    return {
      terminated: type === "natural_stop" || type === "explicit_tool",
      type,
      status: type === "natural_stop" ? "completed" : "incomplete",
      reason,
    };
  }
}
