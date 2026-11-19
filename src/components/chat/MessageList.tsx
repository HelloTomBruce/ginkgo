"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@ai-sdk/react";
import { ArrowDown, ArrowUp, Loader2, Sparkles, FileCode, Printer, Star, GitFork, RotateCcw, Square, Play, Brain, ListOrdered, X, Pin, CheckCircle2, AlertTriangle } from "lucide-react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";
import {
  dedupeContentBlocks,
  type ContentBlock,
  type ToolInvocationState,
} from "./contentBlocks";

// 供既有引用方继续从 MessageList 导入（类型已下沉至 contentBlocks）
export type { ToolInvocationState } from "./contentBlocks";
import { Hint } from "@/components/ui/hint";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownContent } from "./MarkdownContent";
import { extractOpenUI } from "@/lib/extractOpenUI";
import { captureDashboardQueries } from "@/lib/dashboardCapture";
import { toast } from "@/lib/toast";
import type { FavoriteDashboardInput, FavoriteResult } from "@/hooks/useDashboards";

export interface FinopsCostAnnotation {
  type: "finops_cost";
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
  durationMs: number;
  [key: string]: unknown;
}

export interface ModelFallbackAnnotation {
  type: "model_fallback";
  from: string;
  to: string;
  reason: string;
  [key: string]: unknown;
}

function extractFinopsAnnotation(annotations?: unknown[]): FinopsCostAnnotation | undefined {
  if (!Array.isArray(annotations)) return undefined;
  for (const a of annotations) {
    if (typeof a === "object" && a !== null && "type" in a && (a as { type: unknown }).type === "finops_cost") {
      return a as FinopsCostAnnotation;
    }
  }
  return undefined;
}

function extractFallbackAnnotation(annotations?: unknown[]): ModelFallbackAnnotation | undefined {
  if (!Array.isArray(annotations)) return undefined;
  for (const a of annotations) {
    if (typeof a === "object" && a !== null && "type" in a && (a as { type: unknown }).type === "model_fallback") {
      return a as ModelFallbackAnnotation;
    }
  }
  return undefined;
}

interface UIPart {
  type: string;
  text?: string;
  toolInvocation?: ToolInvocationState;
  reasoning?: string;
  [key: string]: unknown;
}

interface MessageItemProps {
  msg: Message;
  isStreaming: boolean;
  showRawLang: boolean;
  /** 当前会话启用源（工具调用归因展示）；memo 靠引用稳定，由父层 useMemo 供给 */
  activeSources?: { id: string; name: string }[];
  onRendererAction: (actionPrompt: string) => void;
  /** 打印导出：目标消息标记与触发回调（见 MessageList 打印状态机） */
  isPrintTarget?: boolean;
  onPrintDashboard?: (id: string) => void;
  /** 看板收藏：该消息是否已收藏（按 origin.messageId 判定）与收藏触发 */
  isFavorited?: boolean;
  isFavoritePending?: boolean;
  onFavoriteDashboard?: (messageId: string) => void;
  /** 画布钉选：是否已钉选至右侧协同画布及触发回调 */
  isPinned?: boolean;
  onPinDashboard?: (messageId: string, dsl: string, title?: string) => void;
  /** 会话操作：从该消息分叉新会话；回滚到该用户消息重问（仅 user 消息展示） */
  onForkMessage?: (messageId: string) => void;
  onRewindMessage?: (messageId: string) => void;
}

/** 工具调用徽标：按 <id>_ 前缀归因到源名称，未匹配走通用兜底 */
function toolBadgeText(
  toolName: string,
  args: Record<string, unknown> | undefined,
  activeSources?: { id: string; name: string }[]
): string {
  const dyn = activeSources?.find((s) => toolName.startsWith(`${s.id}_`));
  if (dyn) {
    return toolName.endsWith("execute_sql")
      ? `⚡ [${dyn.name}] 执行 SQL: ${args?.sql || ""}`
      : `⚡ [${dyn.name}] 调用: ${toolName}`;
  }
  return `⚡ [MCP Tool] 调用: ${toolName}`;
}

/**
 * 深度思考过程展示器：
 * - 流式思考中（active）自动展开，伴随脉冲呼吸灯、光标动画与实时自动平滑滚动；
 * - 思考完成后默认收起为精简状态，支持用户自由展开/折叠查验完整推理链；
 * - 若用户主动点击切换折叠状态，优先遵从用户的手动选择。
 * - 流式期间只渲染尾部窗口：推理模型的思考可达数万字符，whitespace-pre-wrap
 *   长块每帧全量重排（配合 autoScroll 的 scrollHeight 强制同步布局）会卡死主线程；
 *   尾部窗口把每帧重排成本限在常量级，完成后回源全文（默认收起，展开可查）
 */
/** 流式思考中的尾部渲染窗口（字符数） */
const STREAMING_TAIL_CHARS = 3000;

const ReasoningViewer = React.memo(function ReasoningViewer({
  reasoning,
  isStreaming,
  isLast,
  defaultOpen = false,
}: {
  reasoning: string;
  isStreaming: boolean;
  isLast: boolean;
  defaultOpen?: boolean;
}) {
  const isActivelyThinking = isStreaming && isLast;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const isOpen = userToggled !== null ? userToggled : (isActivelyThinking || defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  // 尾部窗口：仅流式思考中生效；完成后恢复全文（思考块默认收起，全文展开可查）
  const tailTruncated =
    isActivelyThinking && reasoning.length > STREAMING_TAIL_CHARS;
  const displayReasoning = tailTruncated
    ? reasoning.slice(-STREAMING_TAIL_CHARS)
    : reasoning;

  useEffect(() => {
    if (isActivelyThinking && contentRef.current) {
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
          scrollRafRef.current = null;
        });
      }
    }
  }, [reasoning, isActivelyThinking]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  return (
    <details
      open={isOpen}
      onToggle={(e) => {
        setUserToggled((e.target as HTMLDetailsElement).open);
      }}
      className={`no-print text-xs rounded-xl border transition-all ${
        isActivelyThinking
          ? "bg-surface-sunken border-border-strong shadow-2xs"
          : "bg-surface-sunken/60 border-border"
      }`}
    >
      <summary className="cursor-pointer font-medium select-none flex items-center justify-between px-3 py-2 text-foreground-subtle hover:text-foreground-strong">
        <div className="flex items-center gap-2">
          <Brain
            className={`w-3.5 h-3.5 transition-colors ${
              isActivelyThinking
                ? "text-foreground-strong"
                : "text-foreground-faint"
            }`}
          />
          <span className={isActivelyThinking ? "text-foreground-strong font-medium" : ""}>
            {isActivelyThinking ? "正在深度思考..." : "思考过程"}
          </span>
        </div>
        <div>
          {isActivelyThinking ? (
            <span className="text-[10px] bg-surface-raised text-foreground-subtle border border-border px-2 py-0.5 rounded font-sans font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-info-fg animate-pulse" />
              思考中
            </span>
          ) : (
            <span className="text-[10px] bg-surface-subtle text-foreground-faint px-1.5 py-0.5 rounded font-sans">
              已完成思考
            </span>
          )}
        </div>
      </summary>
      <div
        ref={contentRef}
        className="px-3 pb-3 pt-1 border-t border-border/50 max-h-72 overflow-y-auto font-mono text-[11px] leading-relaxed text-foreground-subtle"
      >
        <div className="whitespace-pre-wrap opacity-90 break-words">
          {tailTruncated && (
            <div className="text-foreground-faint italic" data-testid="reasoning-tail-note">
              …（思考较长，流式期间仅展示末尾片段）
            </div>
          )}
          {displayReasoning}
          {isActivelyThinking && (
            <span className="inline-block w-1.5 h-3 bg-info-solid animate-pulse ml-0.5 align-middle rounded-xs" />
          )}
        </div>
      </div>
    </details>
  );
});

/**
 * 单条消息（memo 化）。流式期间仅最后一条消息的 content/parts 变化，
 * 历史消息跳过重渲染与 openui DSL 的重复 AST 解析。
 */
const MessageItem = React.memo(function MessageItem({
  msg,
  isStreaming,
  showRawLang,
  activeSources,
  onRendererAction,
  isPrintTarget = false,
  onPrintDashboard,
  isFavorited = false,
  isFavoritePending = false,
  onFavoriteDashboard,
  isPinned = false,
  onPinDashboard,
  onForkMessage,
  onRewindMessage,
}: MessageItemProps) {
  const rawContent = msg.content;
  const rawMsg = msg as unknown as {
    parts?: UIPart[];
    toolInvocations?: ToolInvocationState[];
  };
  const parts = rawMsg.parts;
  const toolInvocations = rawMsg.toolInvocations;

  // 从消息 annotations 中提取 FinOps 耗时/成本与模型降级信息
  const finopsAnnotation = useMemo(() => {
    return extractFinopsAnnotation(msg.annotations as unknown[]);
  }, [msg.annotations]);

  const fallbackAnnotation = useMemo(() => {
    return extractFallbackAnnotation(msg.annotations as unknown[]);
  }, [msg.annotations]);

  // 将消息解析为按真实执行顺序排列的内容块（文本/工具/思考）
  const blocks = useMemo<ContentBlock[]>(() => {
    // 1. 若存在 AI SDK 的 parts 数组，按真实执行流构建交错分块
    if (Array.isArray(parts) && parts.length > 0) {
      const result: ContentBlock[] = [];
      let currentTools: ToolInvocationState[] = [];
      let currentToolsKey = "";

      const flushTools = () => {
        if (currentTools.length > 0) {
          result.push({
            type: "tools",
            id: currentToolsKey,
            tools: currentTools,
          });
          currentTools = [];
          currentToolsKey = "";
        }
      };

      parts.forEach((part, idx) => {
        if (part.type === "tool-invocation" && part.toolInvocation) {
          if (currentTools.length === 0) {
            currentToolsKey = part.toolInvocation.toolCallId || `tools-${idx}`;
          }
          currentTools.push(part.toolInvocation);
        } else {
          flushTools();
          if (part.type === "text" && typeof part.text === "string") {
            const { textPart, openuiPart, isClosed } = extractOpenUI(part.text);
            result.push({
              type: "text",
              id: `text-${idx}`,
              textPart,
              openuiPart,
              isClosed,
              isLast: idx === parts.length - 1,
            });
          } else if (part.type === "reasoning" && typeof part.reasoning === "string") {
            result.push({
              type: "reasoning",
              id: `reasoning-${idx}`,
              reasoning: part.reasoning,
              isLast: idx === parts.length - 1,
            });
          }
        }
      });
      flushTools();

      // ===== 消息内冗余去重与防御（纯函数，见 contentBlocks.ts）：避免单条回复渲染两套一模一样的报告与看板 =====
      return dedupeContentBlocks(result);
    }

    // 2. 兜底回退：兼容无 parts 消息（历史会话或非流式消息）
    const { textPart, openuiPart, isClosed } = extractOpenUI(rawContent);
    const result: ContentBlock[] = [];
    if (toolInvocations && toolInvocations.length > 0) {
      result.push({
        type: "tools",
        id: "fallback-tools",
        tools: toolInvocations,
      });
    }
    if (textPart || openuiPart || !toolInvocations || toolInvocations.length === 0) {
      result.push({
        type: "text",
        id: "fallback-text",
        textPart,
        openuiPart,
        isClosed,
        isLast: true,
      });
    }
    return result;
  }, [rawContent, parts, toolInvocations]);

  if (msg.role === "user") {
    return (
      <div
        id={`message-${msg.id}`}
        data-message-id={msg.id}
        className={`print-message flex flex-col items-end${
          isPrintTarget ? " print-target" : ""
        }`}
      >
        <div className="ml-auto w-fit max-w-[65%] rounded-2xl p-3.5 text-sm bg-surface-raised text-foreground border border-border-subtle rounded-br-xs shadow-2xs animate-surface-appear">
          <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
        </div>

        {(onForkMessage || onRewindMessage) && msg.id !== "welcome" && (
          <div className="no-print mt-1 flex items-center gap-2 text-[10px] text-foreground-faint justify-end">
            {onForkMessage && (
              <button
                type="button"
                onClick={() => onForkMessage(msg.id)}
                disabled={isStreaming}
                aria-label={`从该消息分叉新会话（消息 ${msg.id}）`}
                title="复制到此为止的对话，分叉为新会话"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-info-fg hover:bg-info-soft disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <GitFork className="w-3 h-3" />
                <span>分叉</span>
              </button>
            )}
            {onRewindMessage && (
              <button
                type="button"
                onClick={() => onRewindMessage(msg.id)}
                disabled={isStreaming}
                aria-label={`回滚到该消息重新提问（消息 ${msg.id}）`}
                title="截断此消息后的对话，内容回填输入框重新提问"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-warning-fg hover:bg-warning-soft disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>回滚重问</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const lastBlock = blocks[blocks.length - 1];
  const isWaitingAfterTools =
    isStreaming &&
    Boolean(
      (lastBlock?.type === "tools" &&
        lastBlock.tools.length > 0 &&
        lastBlock.tools.every((t) => t.state === "result")) ||
        (lastBlock?.type === "text" &&
          !lastBlock.textPart.trim() &&
          !lastBlock.openuiPart &&
          blocks.length > 1 &&
          blocks[blocks.length - 2]?.type === "tools")
    );

  const finishTaskTool = toolInvocations?.find(
    (t) => t.toolName === "finish_task"
  );
  const finishSummary =
    finishTaskTool &&
    typeof finishTaskTool.args === "object" &&
    finishTaskTool.args &&
    "summary" in finishTaskTool.args
      ? String(finishTaskTool.args.summary)
      : undefined;

  const hasMainContent = blocks.some(
    (b) =>
      b.type === "text" &&
      (Boolean(b.textPart && b.textPart.trim()) || Boolean(b.openuiPart))
  );
  const hasOpenuiPart = blocks.some(
    (b) => b.type === "text" && Boolean(b.openuiPart)
  );

  return (
    <div
      id={`message-${msg.id}`}
      data-message-id={msg.id}
      className={`print-message flex flex-col items-start${
        isPrintTarget ? " print-target" : ""
      }`}
    >
      <div className="max-w-4xl rounded-2xl p-4 text-sm bg-card border border-border text-foreground-strong rounded-bl-xs w-full shadow-xs space-y-3.5">
        {blocks.map((block) => {
          if (block.type === "tools") {
            return (
              <div key={block.id} className="no-print space-y-2">
                {block.tools.map((tool, idx: number) => {
                  const isRunning = tool.state !== "result";
                  return (
                    <div
                      key={tool.toolCallId || idx}
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
                        {toolBadgeText(tool.toolName, tool.args, activeSources)}
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
                })}
              </div>
            );
          }

          if (block.type === "reasoning") {
            const shouldDefaultOpen = !isStreaming && block.isLast && !hasMainContent;
            return (
              <ReasoningViewer
                key={block.id}
                reasoning={block.reasoning}
                isStreaming={isStreaming}
                isLast={block.isLast}
                defaultOpen={shouldDefaultOpen}
              />
            );
          }

          // text block
          const hasText = Boolean(block.textPart && block.textPart.trim());
          if (!hasText && !block.openuiPart && !(isStreaming && block.isLast)) {
            return null;
          }

          return (
            <React.Fragment key={block.id}>
              {hasText ? (
                <div className="no-print leading-relaxed">
                  <MarkdownContent
                    content={isStreaming && block.isLast ? block.textPart.trimStart() : block.textPart.trim()}
                    isStreaming={isStreaming && block.isLast}
                  />
                  {isStreaming && block.isLast && !block.openuiPart && (
                    <span className="inline-block w-1.5 h-3.5 bg-info-solid animate-pulse ml-1 align-middle rounded-xs" />
                  )}
                </div>
              ) : isStreaming && block.isLast && !block.openuiPart && !isWaitingAfterTools ? (
                <div className="no-print leading-relaxed">
                  <span className="inline-block w-1.5 h-3.5 bg-info-solid animate-pulse rounded-xs" />
                </div>
              ) : null}

              {/* 兜底：当模型输出文字规划但遗漏 PlanReviewCard DSL 时，渲染就绪确认按钮，确保用户能一键推进到 execute 阶段 */}
              {!block.openuiPart && !isStreaming && block.isLast && /(?:请确认以下分析方案|澄清点说明|分析思路确认)/.test(rawContent) && (
                <div className="no-print mt-3 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-foreground-subtle">
                    规划已就绪，点击开始执行分析：
                  </span>
                  <button
                    type="button"
                    onClick={() => onRendererAction("请按上述已确认的分析思路开始执行，产出完整的分析报告与看板。")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground text-background hover:bg-foreground-strong transition-colors shadow-2xs cursor-pointer select-none"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>按此思路开始分析</span>
                  </button>
                </div>
              )}

              {/* 原始 OpenUI Lang 源代码展示 */}
              {showRawLang && block.openuiPart && (
                <div className="no-print mt-3 bg-surface-sunken text-foreground-strong p-3 rounded-lg text-xs font-mono overflow-x-auto border border-border">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground-subtle mb-1.5">
                    <FileCode className="w-3.5 h-3.5" />
                    <span>OpenUI Lang (Model Generated DSL)</span>
                  </div>
                  <pre className="whitespace-pre-wrap leading-relaxed">{block.openuiPart}</pre>
                </div>
              )}

              {/* 流式渐进式渲染 OpenUI Lang 界面 */}
              {block.openuiPart && (
                <div className="mt-5 space-y-4">
                  <div className="no-print flex items-center justify-between text-xs font-semibold text-foreground-faint uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-info-fg" />
                      <span>OpenUI 动态看板</span>
                      {isStreaming && block.isLast ? (
                        <span className="text-[10px] text-info-fg font-normal lowercase flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-info-solid animate-ping"></span>
                          streaming...
                        </span>
                      ) : !isStreaming && block.isClosed === false ? (
                        <span className="text-[10px] bg-warning-soft text-warning-fg-strong px-1.5 py-0.5 rounded font-normal">
                          输出已截断
                        </span>
                      ) : (
                        <span className="text-[10px] bg-success-soft text-success-fg px-1.5 py-0.5 rounded font-normal">
                          已就绪
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {onPinDashboard && (
                        <Hint label={isPinned ? "已钉选在右侧画布" : "钉选到右侧画布协同查看"}>
                          <button
                            type="button"
                            onClick={() => onPinDashboard(msg.id, block.openuiPart)}
                            disabled={isStreaming}
                            aria-label={isPinned ? `已钉选（消息 ${msg.id}）` : `钉选看板（消息 ${msg.id}）`}
                            className={`flex items-center gap-1 text-[10px] normal-case tracking-normal px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                              isPinned
                                ? "text-info-fg bg-info-soft font-medium"
                                : "text-foreground-faint hover:text-info-fg hover:bg-info-soft"
                            }`}
                          >
                            <Pin className={`w-3 h-3 ${isPinned ? "fill-current" : ""}`} />
                            <span>{isPinned ? "已钉选" : "钉选画布"}</span>
                          </button>
                        </Hint>
                      )}
                      {onFavoriteDashboard && (
                        <button
                          type="button"
                          onClick={() => onFavoriteDashboard(msg.id)}
                          disabled={isStreaming || isFavoritePending}
                          aria-label={
                            isFavorited
                              ? "已收藏，点击覆盖更新"
                              : `收藏看板（消息 ${msg.id}）`
                          }
                          title={
                            isFavorited
                              ? "已收藏，点击覆盖更新为最新看板"
                              : "收藏到看板库"
                          }
                          className={`flex items-center gap-1 text-[10px] normal-case tracking-normal px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                            isFavorited
                              ? "text-warning-fg hover:bg-warning-soft"
                              : "text-foreground-faint hover:text-warning-fg hover:bg-warning-soft"
                          }`}
                        >
                          {isFavoritePending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Star
                              className={`w-3 h-3 ${isFavorited ? "fill-current" : ""}`}
                            />
                          )}
                          <span>{isFavorited ? "已收藏" : "收藏"}</span>
                        </button>
                      )}
                      <Hint label="打印看板，可在打印对话框中另存为 PDF">
                        <button
                          type="button"
                          onClick={() => onPrintDashboard?.(msg.id)}
                          disabled={isStreaming}
                          aria-label={`导出 PDF（消息 ${msg.id}）`}
                          className="flex items-center gap-1 text-[10px] normal-case tracking-normal text-foreground-faint hover:text-info-fg px-1.5 py-0.5 rounded hover:bg-info-soft disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        >
                          <Printer className="w-3 h-3" />
                          <span>导出 PDF</span>
                        </button>
                      </Hint>
                    </div>
                  </div>

                  <OpenUIRenderer
                    content={block.openuiPart}
                    isStreaming={isStreaming && block.isLast}
                    onAction={onRendererAction}
                  />

                  {/* 截断兜底引导：由于达到 Token 长度限制中途截断时，提示用户并提供一键续写按钮 */}
                  {!isStreaming && block.isClosed === false && (
                    <div className="no-print mt-2 p-3 rounded-xl border border-warning-border bg-warning-soft/30 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-warning-fg-strong">
                        <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0" />
                        <span>动态看板代码由于达到模型单次输出上限中途截断，未完整闭合</span>
                      </div>
                      <div className="text-xs text-foreground-subtle leading-relaxed">
                        大模型已完成底层数据探查与文字报告，但在绘制图表时达到单次 Token 长度上限。点击下方按钮即可让模型继续输出剩余看板代码并完成渲染：
                      </div>
                      <div className="pt-1 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onRendererAction(
                              "上面的 ```openui 看板代码由于达到长度上限被截断未闭合。请继续输出未完成的看板代码，确保完整闭合并渲染。"
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground text-background hover:bg-foreground-strong transition-colors shadow-2xs cursor-pointer select-none"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>继续生成完整看板</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* 终态闭环兜底：当模型执行了 finish_task 或完成全量取数，但遗漏 ```openui 看板代码块时，渲染数据就绪总结与一键生成看板按钮 */}
        {!hasOpenuiPart && !isStreaming && finishSummary && (
          <div className="no-print mt-3 p-3.5 rounded-xl border border-success-border bg-success-soft/30 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-success-fg">
              <CheckCircle2 className="w-4 h-4 text-success-fg shrink-0" />
              <span>数据取数与分析计算已全部完成</span>
            </div>
            <div className="text-xs text-foreground-subtle leading-relaxed">
              {finishSummary}
            </div>
            <div className="pt-2 flex items-center justify-between border-t border-success-border/40">
              <span className="text-[11px] text-foreground-faint">
                未检测到可视化看板代码，点击一键产出深度分析报告与图表看板：
              </span>
              <button
                type="button"
                onClick={() =>
                  onRendererAction(
                    "数据取数与计算已全部完成。请立即基于上述结果，输出完整的 Markdown 深度分析报告以及 ```openui 可视化动态看板代码块。"
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground text-background hover:bg-foreground-strong transition-colors shadow-2xs cursor-pointer select-none"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>立即生成报告与看板</span>
              </button>
            </div>
          </div>
        )}

        {/* 如果工具刚执行完，模型正在构思下一段文本/OpenUI组件 */}
        {isWaitingAfterTools && (
          <div className="flex items-center gap-2 text-xs text-foreground-subtle py-1 font-medium animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-info-fg" />
            <span>数据查询已完成，大模型正在组织分析洞察并构建视觉看板...</span>
          </div>
        )}

        {/* 模型降级提示徽标 */}
        {fallbackAnnotation && (
          <div
            data-testid="model-fallback-badge"
            className="no-print mt-2 flex items-center gap-2 p-2.5 rounded-xl bg-warning-soft text-warning-fg-strong border border-warning-border text-xs"
          >
            <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0" />
            <div className="leading-relaxed">
              原模型 <span className="font-mono font-medium">{fallbackAnnotation.from}</span> 调用异常（{fallbackAnnotation.reason}），已自动无缝降级至 <span className="font-mono font-medium">{fallbackAnnotation.to}</span> 继续执行。
            </div>
          </div>
        )}
      </div>

      {/* 会话操作与 FinOps 消耗指标行 */}
      <div className="no-print mt-1.5 flex items-center justify-between text-[10px] text-foreground-faint w-full max-w-4xl px-1">
        <div className="flex items-center gap-2">
          {onForkMessage && msg.id !== "welcome" && (
            <button
              type="button"
              onClick={() => onForkMessage(msg.id)}
              disabled={isStreaming}
              aria-label={`从该消息分叉新会话（消息 ${msg.id}）`}
              title="复制到此为止的对话，分叉为新会话"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-info-fg hover:bg-info-soft disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <GitFork className="w-3 h-3" />
              <span>分叉</span>
            </button>
          )}
        </div>

        {finopsAnnotation && (
          <div
            data-testid="finops-cost-badge"
            className="flex items-center gap-1.5 font-mono text-[10px] text-foreground-faint select-none ml-auto"
            title={`模型: ${finopsAnnotation.model || "未知"}\nPrompt: ${finopsAnnotation.promptTokens.toLocaleString()} tokens\nCompletion: ${finopsAnnotation.completionTokens.toLocaleString()} tokens`}
          >
            <span>⚡ {(finopsAnnotation.durationMs / 1000).toFixed(1)}s</span>
            <span>·</span>
            <span>{finopsAnnotation.totalTokens.toLocaleString()} tokens</span>
            {typeof finopsAnnotation.costUsd === "number" && (
              <>
                <span>·</span>
                <span className="text-foreground-subtle font-medium">
                  ${finopsAnnotation.costUsd < 0.0001 && finopsAnnotation.costUsd > 0
                    ? finopsAnnotation.costUsd.toExponential(2)
                    : finopsAnnotation.costUsd.toFixed(4)}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface MessageListProps {
  sessionId?: string;
  messages: Message[];
  /** useChat 状态：submitted | streaming | ready | error */
  status: string;
  error: Error | undefined;
  showRawLang: boolean;
  /** 当前会话启用的数据源（加载提示与工具归因），由父层 useMemo 供给 */
  activeSources?: { id: string; name: string }[];
  onRendererAction: (actionPrompt: string) => void;
  onReload: () => void;
  /** 看板收藏：已收藏消息 id 集合（按收藏记录 origin.messageId 判定） */
  favoritedMessageIds?: Set<string>;
  /** 收藏回调：MessageList 组装 dsl/prompt/sourceNames/origin.messageId，sessionId 由上层补齐 */
  onFavoriteDashboard?: (
    input: FavoriteDashboardInput
  ) => Promise<FavoriteResult>;
  /** 画布钉选：当前钉选的消息 ID 与钉选回调 */
  pinnedMessageId?: string | null;
  onPinDashboard?: (messageId: string, dsl: string, title?: string) => void;
  /** 会话操作：从某条消息分叉新会话；回滚到某条用户消息重问 */
  onForkMessage?: (messageId: string) => void;
  onRewindMessage?: (messageId: string) => void;
  /** 中止/暂停当前生成 */
  onStop?: () => void;
}

/** 距顶/底多远以内视为「已在顶/底」（阈值像素） */
const SCROLL_EDGE_THRESHOLD = 120;

export function MessageList({
  sessionId,
  messages,
  status,
  error,
  showRawLang,
  activeSources,
  onRendererAction,
  onReload,
  favoritedMessageIds,
  onFavoriteDashboard,
  pinnedMessageId,
  onPinDashboard,
  onForkMessage,
  onRewindMessage,
  onStop,
}: MessageListProps) {
  // isLoading 与 status 同源，内部派生避免双重传参
  const isLoading = status === "submitted" || status === "streaming";

  // 快捷滚动与导航：右侧悬浮 DSH 风格「回到顶部 / 消息提问跳转 / 回到底部」
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [showNavigator, setShowNavigator] = useState(false);
  const navigatorMenuRef = useRef<HTMLDivElement>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtTop(el.scrollTop <= SCROLL_EDGE_THRESHOLD);
    setAtBottom(distanceFromBottom <= SCROLL_EDGE_THRESHOLD);
  }, []);

  // 挂载后校准一次（恢复历史长会话时初始位置可能不在底部）
  useEffect(() => {
    updateScrollState();
  }, [updateScrollState]);

  const scrollToEdge = useCallback((top: number, behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior });
    } else {
      el.scrollTop = top;
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el) scrollToEdge(el.scrollHeight, behavior);
  }, [scrollToEdge]);

  const hasMessages = messages.length > 0;
  // 会话加载后（组件挂载、会话切换或消息初次加载），自动滚动到最下面
  useEffect(() => {
    if (!hasMessages) return;
    // 首次即刻滚到底部
    scrollToBottom("auto");
    // 延后微调（等待 Markdown 与 OpenUI 卡片计算高度）
    const raf = requestAnimationFrame(() => {
      scrollToBottom("auto");
      updateScrollState();
    });
    const timer = setTimeout(() => {
      scrollToBottom("smooth");
      updateScrollState();
    }, 120);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [sessionId, hasMessages, scrollToBottom, updateScrollState]);

  // 提取用户提问列表，供 DSH 风格消息快捷跳转使用
  const userMessages = useMemo(() => {
    return messages
      .map((m, idx) => ({ ...m, originalIndex: idx }))
      .filter((m) => m.role === "user");
  }, [messages]);

  // 点击外部关闭快捷跳转菜单
  useEffect(() => {
    if (!showNavigator) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        navigatorMenuRef.current &&
        !navigatorMenuRef.current.contains(e.target as Node)
      ) {
        setShowNavigator(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNavigator]);

  // 跳转到指定提问消息，并平滑聚焦 + 短暂高亮提示
  const handleJumpToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`message-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-info-solid", "transition-all");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-info-solid");
      }, 1500);
    }
    setShowNavigator(false);
  }, []);

  // 1. 发送消息后（消息数量增加或进入 loading 态）：自动平滑滚动到最下方
  const prevMessagesLengthRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current || isLoading) {
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
      });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, isLoading, scrollToBottom]);

  // 2. 流式传输中（助手消息内容增量变化）：若用户原本就在底部，保持跟随滚动到最下方（RAF 帧级节流，防主线程抢占）
  const lastMessage = messages[messages.length - 1];
  const lastContent = lastMessage?.content;
  const streamingScrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (status === "streaming" && atBottom) {
      if (streamingScrollRafRef.current === null) {
        streamingScrollRafRef.current = requestAnimationFrame(() => {
          scrollToBottom("auto");
          streamingScrollRafRef.current = null;
        });
      }
    }
  }, [lastContent, status, atBottom, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (streamingScrollRafRef.current !== null) {
        cancelAnimationFrame(streamingScrollRafRef.current);
        streamingScrollRafRef.current = null;
      }
    };
  }, []);

  /**
   * 看板打印状态机：标记目标消息 → body 加 print-mode → 下一帧 window.print()
   * （等 React 渲染出 print-target）→ afterprint（含取消）清理标记还原页面。
   */
  const [printTargetId, setPrintTargetId] = useState<string | null>(null);

  const handlePrintDashboard = useCallback((id: string) => {
    setPrintTargetId(id);
  }, []);

  /**
   * 看板收藏：按消息组装收藏载荷（dsl 提取自消息内容；prompt 取该消息之前
   * 最近一条用户提问；sourceNames 归档当前启用源名称；origin.messageId 用于
   * 重复收藏覆盖判定）。活看板生成期捕获（P2-A）：从该消息自身的 execute 轮
   * 工具调用记录提取「被看板组件直接引用的取数查询」，随载荷入服务端看板库；
   * 捕获失败或无直取数组件时静默降级为纯快照收藏。结果 toast：新收藏/覆盖
   * 更新/失败（含 413 等服务端错误）。
   */
  const [pendingFavoriteId, setPendingFavoriteId] = useState<string | null>(null);

  const handleFavoriteDashboard = useCallback(
    async (msgId: string) => {
      if (!onFavoriteDashboard) return;
      const idx = messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const { openuiPart } = extractOpenUI(messages[idx].content);
      if (!openuiPart) return;

      // 向前找最近一条用户提问作为「重新分析」种子
      let prompt: string | undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          prompt = messages[i].content;
          break;
        }
      }

      // SAFETY: 同 MessageItem——AI SDK v4 Message 运行时附加 toolInvocations / parts，
      // 仅做可选读取；若 toolInvocations 为空但存在 parts，从 parts 中归集工具调用；捕获引擎内部吞错，绝不阻塞收藏主流程
      const rawTargetMsg = messages[idx] as unknown as {
        toolInvocations?: ToolInvocationState[];
        parts?: UIPart[];
      };
      let toolInvocations = rawTargetMsg.toolInvocations || [];
      if (toolInvocations.length === 0 && Array.isArray(rawTargetMsg.parts)) {
        toolInvocations = rawTargetMsg.parts
          .filter(
            (p): p is { type: "tool-invocation"; toolInvocation: ToolInvocationState } =>
              p.type === "tool-invocation" && !!p.toolInvocation
          )
          .map((p) => p.toolInvocation);
      }
      const capture = captureDashboardQueries(
        openuiPart,
        toolInvocations,
        activeSources ?? []
      );

      const wasFavorited = favoritedMessageIds?.has(msgId) ?? false;
      setPendingFavoriteId(msgId);
      try {
        const res = await onFavoriteDashboard({
          dsl: openuiPart,
          prompt,
          sourceNames: activeSources?.map((s) => s.name),
          origin: { messageId: msgId },
          // 空捕获不携带字段（服务端视为未提供；重复收藏时也无需清空——
          // 旧记录若已有捕获，同消息重跑 execute 后捕获会整体覆盖）
          ...(capture.queries.length > 0
            ? {
                queries: capture.queries,
                bindings: capture.bindings,
                ...(capture.transforms
                  ? { transforms: capture.transforms }
                  : {}),
              }
            : {}),
        });
        if (res.ok) {
          toast(wasFavorited ? "收藏已更新" : "已收藏到看板库", "success");
        } else {
          toast(res.error || "收藏失败", "error");
        }
      } finally {
        setPendingFavoriteId(null);
      }
    },
    [messages, onFavoriteDashboard, favoritedMessageIds, activeSources]
  );

  useEffect(() => {
    if (!printTargetId) return;
    document.body.classList.add("print-mode");
    const restore = () => {
      document.body.classList.remove("print-mode");
      setPrintTargetId(null);
    };
    window.addEventListener("afterprint", restore);
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("afterprint", restore);
      document.body.classList.remove("print-mode");
    };
  }, [printTargetId]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        data-scroll-container=""
        className="h-full overflow-y-auto p-6 space-y-6"
      >
      {messages.map((msg, index) => (
        <MessageItem
          key={msg.id || `msg-${index}`}
          msg={msg}
          isStreaming={index === messages.length - 1 && status === "streaming"}
          showRawLang={showRawLang}
          activeSources={activeSources}
          onRendererAction={onRendererAction}
          isPrintTarget={printTargetId === msg.id}
          onPrintDashboard={handlePrintDashboard}
          isFavorited={favoritedMessageIds?.has(msg.id) ?? false}
          isFavoritePending={pendingFavoriteId === msg.id}
          isPinned={pinnedMessageId === msg.id}
          onPinDashboard={onPinDashboard}
          onFavoriteDashboard={
            onFavoriteDashboard ? handleFavoriteDashboard : undefined
          }
          onForkMessage={onForkMessage}
          onRewindMessage={onRewindMessage}
        />
      ))}

      {/* 当用户刚发出消息，大模型尚在准备第一阶段响应时的全局 Thinking Loading 卡片 */}
      {isLoading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex flex-col items-start">
          <div className="max-w-4xl rounded-2xl p-4 text-sm bg-card border border-border text-foreground-strong rounded-bl-xs w-full shadow-xs space-y-3">
            <div className="flex items-center justify-between text-xs text-info-fg font-medium">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-info-fg" />
                <span>
                  {activeSources && activeSources.length > 0
                    ? `AI 正在分析意图并连接 ${activeSources
                        .map((s) => s.name)
                        .join(" / ")} 数据源...`
                    : "AI 正在分析意图并连接已启用的数据源..."}
                </span>
              </div>
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-danger-soft hover:bg-danger-soft-hover text-danger-fg border border-danger-border transition-colors cursor-pointer select-none"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>停止响应</span>
                </button>
              )}
            </div>
            <div className="space-y-2 pt-1">
              <Skeleton className="h-3 rounded-full w-3/4" />
              <Skeleton className="h-3 rounded-full w-1/2" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-danger-soft border border-danger-border rounded-xl text-xs text-danger-fg-strong flex items-start gap-3">
          <span className="font-bold">⚠️ 请求异常:</span>
          <span className="flex-1 font-mono">{error.message || String(error)}</span>
          <button
            onClick={onReload}
            className="px-2.5 py-1 bg-danger-soft-strong hover:bg-danger-soft-hover rounded text-danger-fg-strong font-medium transition-colors"
          >
            重试
          </button>
        </div>
      )}
      </div>

      {/* 右侧消息快捷跳转与滚动导航轨（DSH 风格） */}
      {(!atTop || !atBottom || userMessages.length > 1) && (
        <div className="no-print absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
          <div className="flex flex-col gap-1 p-1 rounded-2xl bg-card/90 backdrop-blur-md border border-border shadow-md">
            {!atTop && (
              <Hint label="回到顶部" side="left">
                <button
                  type="button"
                  onClick={() => scrollToEdge(0)}
                  aria-label="回到顶部"
                  className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              </Hint>
            )}

            {userMessages.length > 0 && (
              <div className="relative">
                <Hint label={`消息快捷跳转（共 ${userMessages.length} 条提问）`} side="left">
                  <button
                    type="button"
                    onClick={() => setShowNavigator((v) => !v)}
                    aria-label="消息快捷跳转"
                    className={`w-7 h-7 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      showNavigator
                        ? "bg-info-soft text-info-fg font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                </Hint>

                {showNavigator && (
                  <div
                    ref={navigatorMenuRef}
                    className="absolute right-full mr-2.5 top-1/2 -translate-y-1/2 z-30 w-72 max-h-80 rounded-xl bg-card border border-border shadow-xl p-3 flex flex-col gap-2 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
                  >
                    <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <ListOrdered className="w-3.5 h-3.5 text-info-fg" />
                        <span>消息快捷跳转</span>
                        <span className="text-[10px] text-foreground-faint px-1.5 py-0.5 rounded-full bg-surface-sunken font-mono">
                          {userMessages.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowNavigator(false)}
                        className="p-1 rounded text-foreground-faint hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        aria-label="关闭跳转菜单"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="overflow-y-auto space-y-1 pr-1 max-h-60 text-xs">
                      {userMessages.map((um, idx) => (
                        <button
                          key={um.id || idx}
                          type="button"
                          onClick={() => handleJumpToMessage(um.id)}
                          className="w-full text-left p-2 rounded-lg hover:bg-muted/80 transition-colors flex items-start gap-2 group cursor-pointer"
                        >
                          <span className="shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-info-soft text-info-fg group-hover:bg-info-soft-strong transition-colors">
                            #{idx + 1}
                          </span>
                          <span className="line-clamp-2 text-foreground-subtle group-hover:text-foreground leading-relaxed break-all">
                            {um.content}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="pt-1.5 border-t border-border-subtle flex items-center justify-between text-[11px] text-foreground-faint">
                      <button
                        type="button"
                        onClick={() => {
                          scrollToEdge(0);
                          setShowNavigator(false);
                        }}
                        className="flex items-center gap-1 hover:text-foreground py-0.5 px-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                        <span>顶部</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          scrollToBottom();
                          setShowNavigator(false);
                        }}
                        className="flex items-center gap-1 hover:text-foreground py-0.5 px-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                        <span>最新消息</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!atBottom && (
              <Hint label="回到底部（最新消息）" side="left">
                <button
                  type="button"
                  onClick={() => scrollToBottom()}
                  aria-label="回到底部"
                  className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </Hint>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
