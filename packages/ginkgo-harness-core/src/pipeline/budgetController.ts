export interface ExecutionBudgetConfig {
  /** 单任务最大执行步数（熔断上限），默认 25 */
  maxSteps?: number;
  /** 单任务累计 Token 预算上限（Prompt + Completion），默认 200,000 */
  tokenBudget?: number;
  /** 单任务最大墙钟耗时（毫秒），可选 */
  timeoutMs?: number;
  /** 超限时的告警/遥测回调 */
  onExceeded?: (reason: string, metrics: { steps: number; tokens: number; durationMs: number }) => void;
}

export class ExecutionBudgetExceededError extends Error {
  constructor(public readonly reason: string) {
    super(`Execution budget exceeded: ${reason}`);
    this.name = "ExecutionBudgetExceededError";
  }
}

/**
 * 通用 Agent 任务执行资源熔断控制器
 * 实时监测最大步数、累计 Token 与总耗时三维指标，超限时触发独立 AbortController 中止下游任务。
 */
export class ExecutionBudgetController {
  public readonly maxSteps: number;
  public readonly tokenBudget: number;
  public readonly timeoutMs?: number;

  private _steps: number = 0;
  private _tokens: number = 0;
  private readonly _startTime: number;
  private _isExceeded: boolean = false;
  private _exceededReason?: string;
  private readonly _abortController: AbortController;
  private _timer?: NodeJS.Timeout;

  constructor(private readonly config: ExecutionBudgetConfig = {}) {
    this.maxSteps = Math.min(Math.max(Math.round(config.maxSteps ?? 25), 1), 100);
    this.tokenBudget = Math.min(
      Math.max(Math.round(config.tokenBudget ?? 200_000), 10_000),
      5_000_000
    );
    this.timeoutMs = config.timeoutMs;
    this._startTime = Date.now();
    this._abortController = new AbortController();

    if (this.timeoutMs && this.timeoutMs > 0) {
      this._timer = setTimeout(() => {
        this.triggerExceeded(`任务执行耗时超过上限 ${this.timeoutMs}ms`);
      }, this.timeoutMs);
    }
  }

  get steps(): number {
    return this._steps;
  }

  get tokens(): number {
    return this._tokens;
  }

  get durationMs(): number {
    return Date.now() - this._startTime;
  }

  get isExceeded(): boolean {
    return this._isExceeded;
  }

  get exceededReason(): string | undefined {
    return this._exceededReason;
  }

  get signal(): AbortSignal {
    return this._abortController.signal;
  }

  /**
   * 记录新执行的一步，若步数超出 maxSteps 则触发熔断
   */
  recordStep(): { exceeded: boolean; reason?: string } {
    this._steps++;
    if (!this._isExceeded && this._steps > this.maxSteps) {
      this.triggerExceeded(`执行步数达到上限 ${this.maxSteps} 步`);
    }
    return {
      exceeded: this._isExceeded,
      reason: this._exceededReason,
    };
  }

  /**
   * 记录消耗的 Token，若累计超出 tokenBudget 则触发熔断
   */
  recordUsage(
    usage: { promptTokens?: number; completionTokens?: number } | number
  ): { exceeded: boolean; reason?: string } {
    const delta =
      typeof usage === "number"
        ? usage
        : (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);

    this._tokens += Math.max(0, delta);

    if (!this._isExceeded && this._tokens > this.tokenBudget) {
      this.triggerExceeded(
        `累计消耗 ${this._tokens} tokens 超出预算上限 ${this.tokenBudget}`
      );
    }

    return {
      exceeded: this._isExceeded,
      reason: this._exceededReason,
    };
  }

  /**
   * 外部显式中止或由超时触发
   */
  triggerExceeded(reason: string): void {
    if (this._isExceeded) return;
    this._isExceeded = true;
    this._exceededReason = reason;

    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }

    this.config.onExceeded?.(reason, {
      steps: this._steps,
      tokens: this._tokens,
      durationMs: this.durationMs,
    });

    this._abortController.abort(new ExecutionBudgetExceededError(reason));
  }

  /**
   * 任务完成时释放计时器
   */
  dispose(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
  }
}
