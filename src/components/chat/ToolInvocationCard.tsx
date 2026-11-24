"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import type { ToolInvocationState } from "./contentBlocks";
import type {
  AppToolRendererSpec,
  AppToolApprovalRule,
  ModeEscalationChangeItem,
  ModeEscalationPayload,
} from "@ginkgo/app-sdk";
import { DiffViewer, ApprovalCard, ModeApprovalCard, TerminalViewer } from "@ginkgo/components";

export interface ToolInvocationCardProps {
  tool: ToolInvocationState;
  toolRenderers?: AppToolRendererSpec[];
  approvalRules?: AppToolApprovalRule[];
  activeSources?: { id: string; name: string }[];
  onRendererAction?: (prompt: string) => void;
  /** 模式提权批准回调（可选）：原子切换会话为 build 模式并启动构建 */
  onApproveEscalation?: (payload: ModeEscalationPayload) => void;
}

const ESCALATION_CHANGE_TYPES = new Set([
  "file_create",
  "file_modify",
  "dependency_install",
  "command",
  "database",
]);

const RISK_LEVELS = new Set(["low", "medium", "high"]);

/** 默认摘要（模型漏传 summary 时兜底展示） */
const DEFAULT_ESCALATION_SUMMARY = "申请切换至构建模式以执行具体落地构建";

/**
 * 模式提权载荷边界归一：模型经工具入参透传的 args 属不可信外部数据，
 * 在进入渲染层前逐项校验清洗（changes 仅保留 type 枚举合法且 target 为
 * 非空字符串的条目），渲染组件无需再做防御分支。
 */
export function normalizeModeEscalationPayload(
  rawArgs: Record<string, unknown> | undefined
): ModeEscalationPayload {
  const rawChanges = Array.isArray(rawArgs?.changes) ? rawArgs?.changes : [];
  const changes = rawChanges
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .filter(
      (item) =>
        typeof item.target === "string" &&
        item.target.trim().length > 0 &&
        typeof item.type === "string" &&
        ESCALATION_CHANGE_TYPES.has(item.type)
    )
    .map((item) => ({
      type: item.type as ModeEscalationChangeItem["type"],
      target: item.target as string,
      ...(typeof item.description === "string"
        ? { description: item.description }
        : {}),
    }));

  const riskLevel =
    typeof rawArgs?.riskLevel === "string" && RISK_LEVELS.has(rawArgs.riskLevel)
      ? (rawArgs.riskLevel as ModeEscalationPayload["riskLevel"])
      : "medium";

  return {
    targetMode: "build",
    summary:
      typeof rawArgs?.summary === "string" && rawArgs.summary.trim()
        ? rawArgs.summary
        : DEFAULT_ESCALATION_SUMMARY,
    changes,
    riskLevel,
    ...(typeof rawArgs?.actionPrompt === "string" && rawArgs.actionPrompt.trim()
      ? { actionPrompt: rawArgs.actionPrompt }
      : {}),
  };
}

/** 工具调用徽标文本（兜底默认渲染） */
function getFallbackBadgeText(
  toolName: string,
  args: Record<string, unknown> | undefined,
  activeSources?: { id: string; name: string }[]
): string {
  if (toolName === "__tool_call_feedback__") {
    return "⚡ 参数纠错";
  }
  const dyn = activeSources?.find((s) => toolName.startsWith(`${s.id}_`));
  if (dyn) {
    return toolName.endsWith("execute_sql")
      ? `⚡ [${dyn.name}] 执行 SQL: ${args?.sql || ""}`
      : `⚡ [${dyn.name}] 调用: ${toolName}`;
  }
  return `⚡ 工具调用: ${toolName}`;
}

export function ToolInvocationCard({
  tool,
  toolRenderers,
  approvalRules,
  activeSources,
  onRendererAction,
  onApproveEscalation,
}: ToolInvocationCardProps) {
  const isRunning = tool.state !== "result";
  const [localApproved, setLocalApproved] = useState(false);
  const [localRejected, setLocalRejected] = useState<string | false>(false);

  // 0. 模式提权主动审批 (Plan -> Build)
  if (tool.toolName === "request_build_permission") {
    // 工具结果恒为 pending_approval（申请已送达、等待用户决策），
    // 因此此处完成态不代表放行——仅用户点击后才流转状态
    const payload = normalizeModeEscalationPayload(
      tool.args as Record<string, unknown> | undefined
    );

    const handleApprove = (p: ModeEscalationPayload) => {
      setLocalApproved(true);
      if (onApproveEscalation) {
        onApproveEscalation(p);
      } else {
        onRendererAction?.(
          p.actionPrompt || `我已批准权限申请，请切换至 Build 模式并严格按照规划方案执行：${p.summary}`
        );
      }
    };

    const handleReject = (feedback?: string) => {
      const reason = feedback || "用户暂不希望进入构建模式，请继续保持在 Plan 模式调整方案。";
      setLocalRejected(reason);
      onRendererAction?.(
        `[保持规划] 我已暂缓进入构建模式。调整建议：${reason}。请重新在 Plan 模式下优化方案。`
      );
    };

    const status = localApproved
      ? "approved"
      : localRejected !== false
      ? "rejected"
      : "pending";

    return (
      <ModeApprovalCard
        payload={payload}
        status={status}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );
  }

  // 1. 匹配审批规则
  const matchedApprovalRule = approvalRules?.find((rule) => {
    if (rule.toolName !== tool.toolName && rule.toolName !== "*") return false;
    if (rule.condition && tool.args) {
      try {
        return rule.condition(tool.args);
      } catch {
        return false;
      }
    }
    return true;
  });

  // 2. 匹配自定义渲染器
  const matchedRenderer = toolRenderers?.find((spec) => {
    if (spec.toolName === tool.toolName) return true;
    if (spec.toolName.endsWith("*") && tool.toolName.startsWith(spec.toolName.slice(0, -1))) {
      return true;
    }
    return false;
  });

  // 3. 处理人机审批渲染 (Human-in-the-Loop)
  if (matchedApprovalRule) {
    const handleApprove = () => {
      setLocalApproved(true);
      onRendererAction?.(
        `[人工批准] 我已确认并批准执行操作：${matchedApprovalRule.title} (${tool.toolName})。请继续执行。`
      );
    };

    const handleReject = (feedback?: string) => {
      const reason = feedback || matchedApprovalRule.defaultRejectFeedback || "用户拒绝了此项操作";
      setLocalRejected(reason);
      onRendererAction?.(
        `[人工拒绝] 我已拒绝执行操作：${matchedApprovalRule.title} (${tool.toolName})。原因/指示：${reason}。请重新调整方案。`
      );
    };

    // 完成态语义：工具已有 result 即代表服务端已放行执行（含历史会话恢复场景），
    // 此时不应再显示「审批中」误导用户；仅 running 中等待用户交互时显示 pending
    const status = localApproved
      ? "approved"
      : localRejected !== false
      ? "rejected"
      : isRunning
      ? "pending"
      : "approved";

    // 审批卡内部载荷视图（如命令或代码变动）
    let approvalPayload: React.ReactNode = null;
    if (tool.toolName === "run_command" && tool.args?.command) {
      approvalPayload = (
        <TerminalViewer
          command={String(tool.args.command)}
          isRunning={false}
          defaultOpen={false}
        />
      );
    } else if (tool.toolName === "edit_file" && tool.args?.target && tool.args?.replacement) {
      approvalPayload = (
        <DiffViewer
          original={String(tool.args.target)}
          modified={String(tool.args.replacement)}
          title={`修改文件: ${tool.args.path || ""}`}
          defaultOpen={true}
        />
      );
    }

    return (
      <ApprovalCard
        title={matchedApprovalRule.title}
        riskLevel={matchedApprovalRule.riskLevel}
        status={status}
        onApprove={handleApprove}
        onReject={handleReject}
      >
        {approvalPayload}
      </ApprovalCard>
    );
  }

  // 4. 处理高级通用渲染器 (Diff / Terminal / Json)
  if (matchedRenderer) {
    // 4.1 Diff 视图渲染器
    if (matchedRenderer.renderer === "diff") {
      const args = tool.args || {};
      const target = typeof args.target === "string" ? args.target : undefined;
      const replacement = typeof args.replacement === "string" ? args.replacement : undefined;
      const content = typeof args.content === "string" ? args.content : undefined;
      const patch = typeof args.diff === "string" ? args.diff : undefined;

      const title =
        matchedRenderer.title ||
        (target && replacement
          ? `代码变更: ${args.path || ""}`
          : content
          ? `写入文件: ${args.path || ""}`
          : `差异比对: ${args.path || ""}`);

      return (
        <DiffViewer
          original={target ?? ""}
          modified={replacement ?? content ?? ""}
          diffText={patch}
          title={title}
          defaultOpen={matchedRenderer.defaultOpen ?? true}
        />
      );
    }

    // 4.2 Terminal 命令行视图渲染器
    if (matchedRenderer.renderer === "terminal") {
      const args = tool.args || {};
      const cmd =
        typeof args.command === "string"
          ? args.command
          : typeof args.sql === "string"
          ? args.sql
          : tool.toolName;

      const res = tool.result as Record<string, unknown> | undefined;
      const stdout =
        typeof res?.stdout === "string"
          ? res.stdout
          : typeof res?.output === "string"
          ? res.output
          : typeof res?.error === "string"
          ? res.error
          : typeof tool.result === "string"
          ? tool.result
          : tool.result !== undefined
          ? JSON.stringify(tool.result, null, 2)
          : undefined;

      const exitCode =
        typeof res?.exitCode === "number"
          ? res.exitCode
          : res?.error
          ? 1
          : tool.state === "result"
          ? 0
          : undefined;

      return (
        <TerminalViewer
          command={cmd}
          output={stdout}
          exitCode={exitCode}
          isRunning={isRunning}
          defaultOpen={matchedRenderer.defaultOpen ?? false}
        />
      );
    }

    // 4.3 自定义 React 组件渲染器
    if (typeof matchedRenderer.renderer === "function") {
      const CustomComponent = matchedRenderer.renderer as React.ComponentType<{
        tool: ToolInvocationState;
      }>;
      return <CustomComponent tool={tool} />;
    }
  }

  // 5. 兜底回退：默认经典胶囊徽标
  return (
    <div
      className={`flex items-center gap-2 text-xs px-3 py-2.5 rounded-lg border transition-all ${
        isRunning
          ? "text-info-fg-strong bg-info-soft/80 border-info-border animate-pulse"
          : "text-foreground-subtle bg-surface-sunken border-border"
      }`}
    >
      <Loader2
        className={`w-3.5 h-3.5 ${
          isRunning ? "animate-spin text-info-fg" : "text-success-fg"
        }`}
      />
      <span className="font-mono flex-1 truncate">
        {getFallbackBadgeText(tool.toolName, tool.args, activeSources)}
      </span>
      {isRunning ? (
        <span className="text-[10px] bg-info-soft-strong text-info-fg-strong px-2 py-0.5 rounded font-sans font-medium flex items-center gap-1">
          查询中...
        </span>
      ) : (
        <span className="text-[10px] bg-success-soft-strong text-success-fg px-2 py-0.5 rounded font-sans font-medium">
          已完成
        </span>
      )}
    </div>
  );
}
