import type { TelemetrySink, RunId } from "../telemetry/telemetry";

export interface ValidationResult<T = unknown> {
  ok: boolean;
  data?: T;
  errors: string[];
}

export interface StructureValidator<T = unknown> {
  readonly name: string;
  /** 对文本进行提取与校验 */
  validate(content: string): ValidationResult<T>;
  /** 校验失败时构造专用的单步修复提示词 */
  buildFixPrompt(content: string, errors: string[]): string;
}

export interface AutoHealingOptions {
  /** 最大尝试自愈轮数（默认为 1 轮，避免循环死锁） */
  maxRounds?: number;
  telemetry?: TelemetrySink;
  runId?: RunId;
  sessionId?: string;
}

/**
 * 结构化输出自愈护栏（对标 Guardrails AI / Instructor）
 * 当模型生成的关键结构（如 DSL/JSON/SQL）存在语法瑕疵时，由底座捕获并触发轻量微循环修复
 */
export class AutoHealingGuardrail {
  private readonly maxRounds: number;
  private readonly telemetry?: TelemetrySink;
  private readonly runId?: RunId;
  private readonly sessionId?: string;

  constructor(options: AutoHealingOptions = {}) {
    this.maxRounds = options.maxRounds ?? 1;
    this.telemetry = options.telemetry;
    this.runId = options.runId;
    this.sessionId = options.sessionId;
  }

  /**
   * 执行自愈防护：
   * 1. 优先校验当前文本；
   * 2. 若合法直接返回（零额外开销）；
   * 3. 若有语法错误，向 healer 申请定向修复，并在轮数内迭代确认。
   */
  async enforce<T>(
    initialText: string,
    validator: StructureValidator<T>,
    healer: (fixPrompt: string) => Promise<string>
  ): Promise<{ text: string; healed: boolean; finalValid: boolean }> {
    let currentText = initialText;
    let round = 0;

    while (round <= this.maxRounds) {
      const check = validator.validate(currentText);
      if (check.ok) {
        return {
          text: currentText,
          healed: round > 0,
          finalValid: true,
        };
      }

      // 达到重试上限，宣告自愈失败并放弃，返回最后文本（由上层降级处理）
      if (round >= this.maxRounds) {
        this.telemetry?.emit({
          type: "warn",
          runId: this.runId ?? ("auto-healing" as RunId),
          sessionId: this.sessionId,
          code: "AUTO_HEALING_EXHAUSTED",
          detail: `[${validator.name}] 自愈尝试 ${this.maxRounds} 轮后仍存在语法错误: ${check.errors.join("; ")}`,
        });
        return {
          text: currentText,
          healed: round > 0,
          finalValid: false,
        };
      }

      round++;
      this.telemetry?.emit({
        type: "warn",
        runId: this.runId ?? ("auto-healing" as RunId),
        sessionId: this.sessionId,
        code: "AUTO_HEALING_TRIGGERED",
        detail: `[${validator.name}] 检测到语法缺陷，触发第 ${round} 轮定向自愈: ${check.errors.join("; ")}`,
      });

      const fixPrompt = validator.buildFixPrompt(currentText, check.errors);
      try {
        currentText = await healer(fixPrompt);
      } catch (err) {
        this.telemetry?.emit({
          type: "warn",
          runId: this.runId ?? ("auto-healing" as RunId),
          sessionId: this.sessionId,
          code: "AUTO_HEALING_FAILED",
          detail: `[${validator.name}] 自愈微循环请求失败: ${err instanceof Error ? err.message : String(err)}`,
        });
        return {
          text: currentText,
          healed: false,
          finalValid: false,
        };
      }
    }

    return {
      text: currentText,
      healed: false,
      finalValid: false,
    };
  }
}
