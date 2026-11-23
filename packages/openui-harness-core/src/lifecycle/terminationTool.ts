import { type CoreTool } from "ai";
import { z } from "zod";
import { zodTool } from "../tools/zodTool";
import type {
  DeliverableAssertion,
  DeliverableAssertionContext,
  TerminationSignal,
  TerminationStatus,
} from "./types";

export interface TerminationToolOptions {
  toolName?: string;
  description?: string;
  /** 当状态为 completed 时触发的交付物验证断言 */
  assertion?: DeliverableAssertion;
  /** 提供动态的上下文证据（供断言函数读取） */
  getAssertionContext?: () => Partial<DeliverableAssertionContext>;
  /** 终态信号确认通过时的回调 */
  onSignalAccepted?: (signal: TerminationSignal) => void;
  /** 终态信号被断言拒绝时的回调 */
  onSignalRejected?: (signal: TerminationSignal, reason: string) => void;
  /** 自定义接受后的指导提示消息 */
  resolveMessage?: (ctx: DeliverableAssertionContext) => string;
}

const terminationSchema = z.object({
  status: z.enum(["completed", "insufficient_data", "blocked"]).describe(
    "任务终态：completed(已完成并交付实质产出)、insufficient_data(缺少关键数据或需澄清)、blocked(外部阻碍不可抗力)"
  ),
  deliverableSummary: z.string().optional().describe("completed 状态下对最终交付产物的总结"),
  summary: z.string().optional().describe("简要终态总结（与 deliverableSummary 等效）"),
  missingInformation: z.array(z.string()).optional().describe("insufficient_data 状态下缺失的关键信息"),
  blockerReason: z.string().optional().describe("blocked 状态下的阻塞原因"),
});

/**
 * 构造通用任务终态工具（如 finish_task）
 */
export function createTerminationTool(
  options: TerminationToolOptions = {}
): CoreTool {
  const desc =
    options.description ??
    "显式声明当前任务达到终态。必须在已完成分析并产出实质内容，或确认数据不足需澄清时调用。";

  return zodTool({
    description: desc,
    parameters: terminationSchema,
    execute: async (args) => {
      const summaryText = args.summary ?? args.deliverableSummary;
      const signal: TerminationSignal = {
        status: args.status as TerminationStatus,
        deliverableSummary: summaryText,
        missingInformation: args.missingInformation,
        blockerReason: args.blockerReason,
      };

      const extraCtx = options.getAssertionContext ? options.getAssertionContext() : {};
      const assertionCtx: DeliverableAssertionContext = {
        status: signal.status,
        signal,
        stepCount: extraCtx.stepCount ?? 0,
        executedTools: extraCtx.executedTools ?? [],
        evidence: extraCtx.evidence,
      };

      // 仅在 status === "completed" 时执行严格交付断言
      if (signal.status === "completed" && options.assertion) {
        const checkResult = options.assertion(assertionCtx);
        const check =
          checkResult instanceof Promise ? await checkResult : checkResult;

        if (!check.passed) {
          const rejectReason =
            check.rejectReason ??
            "无法以 completed 终态结束：未检测到有效实质产出，请完成分析产出或使用 insufficient_data 状态。";

          options.onSignalRejected?.(signal, rejectReason);

          return {
            isError: true,
            accepted: false,
            terminated: false,
            status: "rejected",
            summary: summaryText ?? "",
            message: rejectReason,
          };
        }
      }

      options.onSignalAccepted?.(signal);

      const message = options.resolveMessage
        ? options.resolveMessage(assertionCtx)
        : `任务终态声明已确认: ${signal.status}`;

      return {
        isError: false,
        accepted: true,
        terminated: true,
        status: signal.status,
        summary: summaryText ?? "",
        message,
      };
    },
  });
}
