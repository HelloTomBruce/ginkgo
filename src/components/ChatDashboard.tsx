"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { TrendingUp, Bot, Code2, Settings, RefreshCw } from "lucide-react";
import { resolveContextWindow, estimateMessagesTokens } from "@openui-analytics/llm/context";
import { Hint } from "@/components/ui/hint";
import { DEFAULT_SANDBOX_CODE } from "@/lib/presetQueries";
import { DEFAULT_WELCOME_MESSAGE } from "@/lib/sessionStorage";
import { upsertMessage } from "@/lib/messages";
import { useLlmSettings } from "@/hooks/useLlmSettings";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useDashboards, type FavoriteDashboardInput } from "@/hooks/useDashboards";
import { DashboardPreviewModal } from "@/components/chat/DashboardPreviewModal";
// 仅取类型（编译期擦除）
import type { DashboardRecord } from "@/lib/dashboardStore";
import {
  downloadDashboardSnapshot,
  parseDashboardSnapshot,
} from "@/lib/dashboardSnapshot";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { useDatasourceList } from "@/components/chat/datasources/useDatasources";
import { useMethodologyPresets } from "@/components/chat/useMethodologyPresets";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { ModelSwitcher } from "@/components/chat/ModelSwitcher";
import { ReasoningEffortSwitcher } from "@/components/chat/ReasoningEffortSwitcher";
import { ContextUsageIndicator } from "@/components/chat/ContextUsageIndicator";
import { DevToolsPanel } from "@/components/chat/DevToolsPanel";
import { MethodologyModal } from "@/components/chat/MethodologyModal";
import { ComponentCatalogModal } from "@/components/chat/ComponentCatalogModal";
import type { CanvasDashboardData } from "@openui-apps/analytics";
import { extractOpenUI } from "@/lib/extractOpenUI";
import { appRegistry } from "@/lib/apps/registry";
import { Toaster } from "@/components/Toaster";
import { toast } from "@/lib/toast";

/**
 * AST 沙箱等开发工具仅在 dev 环境露出。
 * 客户端 bundle 中 NODE_ENV 由构建时静态内联（next dev → development，
 * next build → production），生产分支整体被 tree-shake。
 */
const IS_DEV = process.env.NODE_ENV === "development";

/**
 * 组合层：唯一接线点。
 * 状态在 useLlmSettings / useSessionManager 中管理，展示在 chat/ 下的专注子组件中。
 */

/** 上下文用量派生（纯函数，组件外定义以兼容 React Compiler 手动记忆化） */
function deriveContextUsage(
  data: unknown,
  fallbackPromptTokens: number | null,
  model: string,
  contextWindowHint?: string | number,
  sessionPromptTokens?: number | null,
  messages?: unknown[]
): { promptTokens: number; window: number } {
  const windowSize = resolveContextWindow(model, contextWindowHint);
  if (Array.isArray(data) && data.length > 0) {
    for (let i = data.length - 1; i >= 0; i--) {
      const item = data[i] as { type?: string; promptTokens?: number } | null;
      if (
        item &&
        item.type === "context_usage" &&
        typeof item.promptTokens === "number" &&
        item.promptTokens > 0
      ) {
        return { promptTokens: item.promptTokens, window: windowSize };
      }
    }
  }
  if (typeof fallbackPromptTokens === "number" && fallbackPromptTokens > 0) {
    return { promptTokens: fallbackPromptTokens, window: windowSize };
  }
  if (typeof sessionPromptTokens === "number" && sessionPromptTokens > 0) {
    return { promptTokens: sessionPromptTokens, window: windowSize };
  }
  if (Array.isArray(messages) && messages.length > 1) {
    const estimated = estimateMessagesTokens(messages);
    if (estimated > 0) {
      return { promptTokens: estimated, window: windowSize };
    }
  }
  return { promptTokens: 0, window: windowSize };
}

export default function ChatDashboard() {
  const [activeAppId, setActiveAppId] = useState<string>("analytics");
  const activeApp = useMemo(
    () => appRegistry.getOrDefault(activeAppId),
    [activeAppId]
  );
  const [showRawLang, setShowRawLang] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  // 分析方法论查看入口（侧边栏底部按钮打开，弹窗内自取数）
  const [showMethodology, setShowMethodology] = useState(false);
  // 可视化组件查看入口（侧边栏底部按钮打开，目录数据本地派生）
  const [showComponentCatalog, setShowComponentCatalog] = useState(false);
  const [devToolsCode, setDevToolsCode] = useState(DEFAULT_SANDBOX_CODE);
  // 上下文用量兜底（仅在未收到 StreamData 时生效，按 sessionId 绑定）
  const [fallbackPromptTokens, setFallbackPromptTokens] = useState<{
    sessionId?: string;
    tokens: number;
  } | null>(null);

  // 工作台双栏与分析画布状态（M3 协同工作台）
  const [rawViewMode, setViewMode] = useState<"chat-only" | "split" | "canvas-only">("chat-only");
  const [canvasData, setCanvasData] = useState<CanvasDashboardData | null>(null);

  // 插槽能力：由当前应用声明的工作台与辅助插槽组件
  const hasWorkspace = Boolean(activeApp.client.hasWorkspace);
  const WorkspaceComponent = activeApp.client.WorkspaceComponent;
  const InputAccessoryComponent = activeApp.client.InputAccessoryComponent;
  // 当当前应用未开启工作台插槽时，界面纯天然保持单栏对话
  const viewMode = hasWorkspace ? rawViewMode : "chat-only";

  const {
    showSettings,
    setShowSettings,
    providers,
    activeProviderId,
    activeModel,
    activeModelConfig,
    switchActiveModel,
    saveProvider,
    deleteProvider,
    providerId,
    applyProvider,
    apiKey,
    setApiKey,
    baseURL,
    setBaseURL,
    model,
    setModel,
    accessToken,
    setAccessToken,
    temperature,
    setTemperature,
    reasoningEffort,
    setReasoningEffort,
    maxTokens,
    setMaxTokens,
    maxSteps,
    setMaxSteps,
    contextWindow,
    setContextWindow,
    fallbackModels,
    setFallbackModels,
    protocol,
    setProtocol,
    authHeaders,
    saveSettings,
    chatBody,
  } = useLlmSettings();

  // useChat 以欢迎语初始化，会话全文由 useSessionManager bootstrap 后
  // 经 registerSetMessages 注入（构造顺序环解法，见 hook 注释）。
  // 发起请求时的会话 id：流式期间用户可能切换会话，onFinish 须写回发起会话
  const streamingSessionIdRef = useRef<string | null>(null);

  // 数据源列表提前：会话管理生成欢迎语时要按当前启用源与特性开关过滤能力宣称
  const { sources: allDatasources, features: datasourceFeatures } =
    useDatasourceList();
  const welcomeSourcesRef = useRef(allDatasources);
  const welcomeFeaturesRef = useRef(datasourceFeatures);
  useEffect(() => {
    welcomeSourcesRef.current = allDatasources;
    welcomeFeaturesRef.current = datasourceFeatures;
  }, [allDatasources, datasourceFeatures]);

  const {
    sessions,
    currentSessionId,
    activeSession,
    loaded: sessionsLoaded,
    editingSessionId,
    editingTitleText,
    setEditingSessionId,
    setEditingTitleText,
    saveCurrentSessionMessages,
    updateSessionSources,
    registerSetMessages,
    syncMessages,
    getMessages,
    handleCreateNewChat,
    handleSelectSession,
    handleDeleteSession,
    handleStartRename,
    handleSaveRename,
    forkSession,
    rewindSession,
    planMode,
    setPlanMode,
    interactionMode,
    setInteractionMode,
  } = useSessionManager({
    appId: activeAppId,
    welcomeMessage: activeApp.client.welcomeMessage,
    getWelcomeContext: () => ({
      sources: welcomeSourcesRef.current
        .filter((s) => s.enabled !== false)
        .map((s) => ({ id: s.id, name: s.name })),
      features: welcomeFeaturesRef.current,
    }),
  });

  const handleChatError = useCallback((err: Error) => {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[ChatDashboard] 会话流异常:", err);
    }

    // 1. 容错落盘：确保当前提问及已有生成内容不会丢失，会话不中断
    const targetId = streamingSessionIdRef.current;
    if (targetId) {
      try {
        const msgs = getMessages();
        if (msgs && msgs.length > 0) {
          saveCurrentSessionMessages(msgs, targetId, { silent: true });
        }
      } catch (saveErr) {
        console.error("[ChatDashboard] 错误态紧急保存会话失败:", saveErr);
      }
    }

    // 2. 用户主动暂停/终止请求不弹报错提示
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      return;
    }
    const isGeneric =
      !err.message ||
      err.message === "An error occurred." ||
      err.message.includes("Failed to fetch");

    const message = isGeneric
      ? "网络响应中断，已自动保存当前进度，您可以继续提问或点击重试"
      : `响应异常：${err.message}`;

    toast(message, "error");
  }, [getMessages, saveCurrentSessionMessages]);

  // 看板收藏库：列表/收藏/重命名/删除（列表同时驱动侧栏看板库）
  const {
    summaries: dashboardSummaries,
    get: getDashboard,
    favorite: favoriteDashboard,
    rename: renameDashboard,
    remove: removeDashboard,
    refreshOne: refreshDashboardData,
    toggleTemplate: toggleDashboardTemplate,
    createFromTemplate: createDashboardFromTemplate,
  } = useDashboards();
  // 星标判定集合：收藏记录的 origin.messageId
  const favoritedMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of dashboardSummaries) {
      if (s.origin?.messageId) ids.add(s.origin.messageId);
    }
    return ids;
  }, [dashboardSummaries]);
  // MessageList 只组装消息侧字段，sessionId（收藏归档）由本层补齐
  const handleFavoriteDashboard = useCallback(
    (input: FavoriteDashboardInput) =>
      favoriteDashboard({
        ...input,
        origin: { ...input.origin, sessionId: currentSessionId },
      }),
    [favoriteDashboard, currentSessionId]
  );

  // 会话级数据源：列表来自 /api/datasources（上方已取），勾选集写入当前会话并随请求体透传
  const enabledPickerSources = useMemo(
    () => allDatasources.filter((s) => s.enabled !== false),
    [allDatasources]
  );
  const handleSourcesChange = useCallback(
    (ids: string[]) => {
      if (!currentSessionId) return;
      // 会话开始后锁定：上下文已建立在既有源上，中途改动会造成工具归因不一致
      if (getMessages().some((m) => m.role === "user")) return;
      const allIds = enabledPickerSources.map((s) => s.id);
      const isFullSelection =
        ids.length === allIds.length && allIds.every((id) => ids.includes(id));
      // 全选恢复 undefined 语义：后续新增源自动纳入本会话
      updateSessionSources(currentSessionId, isFullSelection ? undefined : ids);
    },
    [currentSessionId, enabledPickerSources, updateSessionSources, getMessages]
  );
  const chatBodyWithSources = useMemo(
    () => ({
      ...chatBody,
      appId: activeAppId,
      sources: activeApp.client.hasInputAccessory
        ? activeSession?.enabledSources
        : [],
      // 上下文治理：服务端按会话读写 token 锚点与摘要缓存
      sessionId: currentSessionId || undefined,
    }),
    [chatBody, activeAppId, activeApp.client.hasInputAccessory, activeSession?.enabledSources, currentSessionId]
  );
  // 当前会话实际启用的源（名称+id）：驱动加载提示与工具归因展示；useMemo 保 MessageItem memo 生效
  const sessionSources = useMemo(() => {
    if (!activeApp.client.hasInputAccessory) return [];
    const sel = activeSession?.enabledSources;
    const list = sel
      ? enabledPickerSources.filter((s) => sel.includes(s.id))
      : enabledPickerSources;
    return list.map((s) => ({ id: s.id, name: s.name }));
  }, [activeApp.client.hasInputAccessory, enabledPickerSources, activeSession?.enabledSources]);

  // 使用 Next.js 官方 Vercel AI SDK 的 useChat Hook
  const {
    messages,
    setMessages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    status,
    append,
    isLoading,
    error,
    reload,
    stop,
    data,
    setData,
  } = useChat({
    api: "/api/analyze",
    body: chatBodyWithSources,
    headers: authHeaders(),
    onError: handleChatError,
    initialMessages: [DEFAULT_WELCOME_MESSAGE],
    // 流式渲染合批：SSE 增量频率远超人眼可辨（推理模型思考流尤甚），
    // 每个 delta 全量重渲染 + 长文重排是页面卡死的根因。throttleit 为
    // leading+trailing 语义，末尾增量保证冲刷，最终内容不丢
    experimental_throttle: 100,
    onFinish: (message, options) => {
      // 流式结束时保存：用 getMessages() 读取最新列表（含多步工具调用的中间消息），
      // upsert 防止与 AI SDK 已合入的最终消息重复；写回发起请求时的会话。
      // 仅在仍持有流式会话标记时落盘——标记被清空（切换/新建已停流）说明
      // 这条 finish 属于旧会话，静默丢弃，防止把 A 会话内容写进 B。
      const targetId = streamingSessionIdRef.current;
      // 上下文用量：记录兜底值（当 StreamData 可用时优先消费真实单步值）
      // 注意：options.usage 是 AI SDK 多步工具调用的【累计值】，只能用于展示兜底；
      // 持久化锚点由服务端 handler 按最后一步单步实测写入（updateContext），
      // 客户端不得再写——否则累计值覆盖实测锚点，后续剪枝判定与展示都会虚高
      const promptTokens = options?.usage?.promptTokens;
      const validTokens =
        typeof promptTokens === "number" && Number.isFinite(promptTokens) && promptTokens > 0
          ? promptTokens
          : undefined;
      if (validTokens) {
        setFallbackPromptTokens({ sessionId: targetId || currentSessionId || undefined, tokens: validTokens });
      }
      if (targetId) {
        saveCurrentSessionMessages(
          upsertMessage(getMessages(), message),
          targetId
        );
      }
    },
  });

  // 上下文用量派生计算：常驻保底展示（未发消息时为 0），无任何闪烁
  // 1. 优先从 data（服务端 StreamData 下发的最后一步真实单步 promptTokens）读取；
  // 2. 其次回退到 onFinish 记录的 fallbackPromptTokens（兼容无 StreamData 场景，绑定当前会话）；
  // 3. 再次回退到活跃会话持久化的 context.lastPromptTokens（跨会话切换与刷新恢复）；
  // 4. 再次依据历史消息估算（estimateMessagesTokens）；
  // 5. 新建空白会话保底为 0。
  const effectiveFallbackTokens =
    fallbackPromptTokens && (!fallbackPromptTokens.sessionId || fallbackPromptTokens.sessionId === currentSessionId)
      ? fallbackPromptTokens.tokens
      : null;

  const contextUsage = deriveContextUsage(
    data,
    effectiveFallbackTokens,
    model,
    contextWindow,
    activeSession?.context?.lastPromptTokens,
    messages
  );

  // 会话多轮累计实际计费 Token 消耗与美元成本汇总（从 assistant 消息的 finops_cost 注解派生）
  const cumulativeStats = useMemo(() => {
    let totalTokens = 0;
    let totalCostUsd = 0;
    let hasCost = false;

    for (const m of messages) {
      if (m.role === "assistant" && Array.isArray(m.annotations)) {
        for (const a of m.annotations) {
          if (
            typeof a === "object" &&
            a !== null &&
            (a as { type?: unknown }).type === "finops_cost"
          ) {
            const costAnn = a as { totalTokens?: number; costUsd?: number };
            if (typeof costAnn.totalTokens === "number" && Number.isFinite(costAnn.totalTokens)) {
              totalTokens += costAnn.totalTokens;
            }
            if (typeof costAnn.costUsd === "number" && Number.isFinite(costAnn.costUsd)) {
              totalCostUsd += costAnn.costUsd;
              hasCost = true;
            }
          }
        }
      }
    }

    return {
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
      costUsd: hasCost ? totalCostUsd : undefined,
    };
  }, [messages]);

  // useChat 就绪后注入 setMessages 与最新消息快照（均由 useSessionManager 内部持有）
  useEffect(() => {
    registerSetMessages(setMessages);
  }, [setMessages, registerSetMessages]);
  useEffect(() => {
    syncMessages(messages);
  }, [messages, syncMessages]);

  // 流式中进度快照与页面离开保护：
  // 1. 每当 messages 更新且处于生成中（isLoading），节流存盘（避免刷新或意外关闭导致已生成内容全丢）
  // 2. 页面刷新/关闭（beforeunload/pagehide）时立即进行最终落盘
  const lastSaveTimeRef = useRef(0);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isLoading || !streamingSessionIdRef.current) return;
    const now = Date.now();
    const sessionId = streamingSessionIdRef.current;

    // 节流 2.5 秒保存一次增量进度（流式中间进度静默保存，不打扰用户）
    if (now - lastSaveTimeRef.current > 2500) {
      lastSaveTimeRef.current = now;
      saveCurrentSessionMessages(messages, sessionId, { silent: true });
    } else if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        lastSaveTimeRef.current = Date.now();
        saveCurrentSessionMessages(getMessages(), sessionId, { silent: true });
      }, 2500);
    }
  }, [messages, isLoading, saveCurrentSessionMessages, getMessages]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleUnload = () => {
      if (isLoading && streamingSessionIdRef.current) {
        const msgs = getMessages();
        if (msgs.length > 0) {
          saveCurrentSessionMessages(msgs, streamingSessionIdRef.current, {
            silent: true,
            keepalive: true,
          });
        }
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [isLoading, getMessages, saveCurrentSessionMessages]);

  // 会话开始（存在用户消息）即锁定数据源选择：仅初始会话（只有欢迎语）可勾选
  const sourcesLocked = messages.some((m) => m.role === "user");

  // Plan-first 状态机：最近一条 assistant 消息含 PlanReviewCard ⇒ 规划待确认，
  // 下一条消息（打字答复或确认按钮注入）按 execute 发送；否则开关开启时按 plan；
  // 都不满足则不带 mode（direct，向后兼容）。会话切换/刷新后由消息历史自然恢复。
  const awaitingPlanConfirm = useMemo(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    return Boolean(
      lastAssistant &&
        (/PlanReviewCard\s*\(/.test(String(lastAssistant.content ?? "")) ||
          /(?:分析思路|分析规划|请确认以下分析方案|澄清点说明)/.test(
            String(lastAssistant.content ?? "")
          ))
    );
  }, [messages]);

  const nextModeBody = useCallback((): { mode?: "plan" | "execute" } => {
    if (awaitingPlanConfirm) return { mode: "execute" };
    if (planMode) return { mode: "plan" };
    return {};
  }, [awaitingPlanConfirm, planMode]);

  // 页面刷新 / 会话挂载后无缝重连：
  // 若服务端当前会话仍有在途后台流式任务，自动发起 reload 重连，无缝续接输出
  // isLoadingRef：探测回调里复查最新流式状态。闭包捕获的 isLoading 可能已过期
  // （fetch 返回与 React 重渲染之间有窗口），只用闭包值会与用户刚提交的新请求并发。
  const isLoadingRef = useRef(false);
  // 提交将发/在途标记：重新分析等「切会话→立即 append」路径中，React 的 isLoading
  // 尚未翻转时重连探测即可能命中在途任务——probe 以此标记为据放弃重连，
  // 待 isLoading 真正翻转为 true（或 append 失败）后放下
  const pendingSubmitRef = useRef(false);
  useEffect(() => {
    isLoadingRef.current = isLoading;
    if (isLoading) pendingSubmitRef.current = false;
  }, [isLoading]);

  // 探测所需的最新回调快照：reload/nextModeBody/authHeaders 的 identity 在流式期间
  // 随 messages 高频变化，若直接放进下方 effect 的 deps，每次重渲染都会重跑探测
  // → GET /api/analyze 刷屏。探测只需在「会话装载完成」时执行一次，回调经 ref 取最新。
  const probeDepsRef = useRef({ reload, nextModeBody, authHeaders });
  useEffect(() => {
    probeDepsRef.current = { reload, nextModeBody, authHeaders };
  });

  useEffect(() => {
    if (!sessionsLoaded || !currentSessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const { reload, nextModeBody, authHeaders } = probeDepsRef.current;
        const res = await fetch(
          `/api/analyze?sessionId=${encodeURIComponent(currentSessionId)}`,
          { headers: { ...authHeaders() } }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { running?: boolean; hasTask?: boolean };
        // 三重复查：cancelled（effect 已被更新取代）、isLoadingRef（用户刚提交）
        // 或已有提交将发/在途（pendingSubmitRef——重新分析切会话后立即 append，
        // React 尚未刷新 isLoading 的窗口期）——任一命中都放弃重连，
        // 防止第二个消费端接入同一在途流造成消息重复
        if (cancelled || isLoadingRef.current || pendingSubmitRef.current) return;
        // running：在途任务无缝续接；hasTask（终态 30s 保留窗）：脱钩期间后台
        // 跑完的任务重放收尾并落盘，否则尾巴内容随清理丢失
        if (!data.running && !data.hasTask) return;

        streamingSessionIdRef.current = currentSessionId;
        const reloadPromise = reload({ body: { ...nextModeBody(), reconnect: true } });
        if (reloadPromise && typeof (reloadPromise as Promise<unknown>).catch === "function") {
          (reloadPromise as Promise<unknown>).catch((err: unknown) => {
            if (process.env.NODE_ENV !== "test") {
              console.warn("[ChatDashboard] 重连流完成或结束:", err);
            }
          });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionsLoaded, currentSessionId]);

  // 提交/追加消息时记录发起会话，供 onFinish 定向保存
  const handleChatSubmit = useCallback(
    (e?: React.FormEvent<HTMLFormElement>) => {
      streamingSessionIdRef.current = currentSessionId;
      handleSubmit(e, { body: nextModeBody() });
    },
    [handleSubmit, currentSessionId, nextModeBody]
  );

  const handleRendererAction = useCallback(
    (actionPrompt: string) => {
      streamingSessionIdRef.current = currentSessionId;
      append({ role: "user", content: actionPrompt }, { body: nextModeBody() });
    },
    [append, currentSessionId, nextModeBody]
  );

  // 在途流的两种处置：
  // - 脱钩（切换/新建会话，默认）：仅中止客户端订阅并落盘进度——服务端 StreamHub
  //   任务继续后台生成，回切时由重连探测无缝续接（页面刷新恢复同构）；
  // - 终止（仅用户显式点击「停止」）：同时通知服务端 abortTask 杀掉后台任务
  const stopActiveStream = useCallback(
    (opts?: { silent?: boolean; killServer?: boolean }) => {
      if (!isLoading) return;
      const activeId = streamingSessionIdRef.current;
      stop();
      if (opts?.killServer && activeId) {
        void fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action: "stop", sessionId: activeId }),
        }).catch(() => {});
      }
      saveCurrentSessionMessages(getMessages(), activeId ?? undefined, {
        silent: true,
      });
      if (!opts?.silent) toast("已暂停生成", "info");
    },
    [isLoading, stop, getMessages, saveCurrentSessionMessages, authHeaders]
  );

  // 暂停/中止当前会话生成（用户显式停止：保留已有内容并即刻持久化，服务端任务一并终止）
  const handleStop = useCallback(
    () => stopActiveStream({ killServer: true }),
    [stopActiveStream]
  );

  // 切换/新建会话前必先脱钩在途流并清空流式会话标记：
  // 否则节流落盘与 onFinish 仍指向旧会话 A，会把新会话 B 的消息写进 A。
  // 脱钩不杀服务端任务（StreamHub 后台续跑），回切时 probe 重连续接输出。
  // StreamData（含 context_usage 真实单步值）随 useChat 实例跨会话存续且 SDK 从不清空，
  // 切换时必须清除，否则用量条继续显示旧会话的 token 峰值直到新会话发起下一次流
  const handleSelectSessionSafe = useCallback(
    (sessionId: string) => {
      stopActiveStream({ silent: true });
      streamingSessionIdRef.current = null;
      setData(undefined);
      void handleSelectSession(sessionId);
    },
    [stopActiveStream, handleSelectSession, setData]
  );

  const handleCreateNewChatSafe = useCallback((opts?: { workspaceId?: string }) => {
    stopActiveStream({ silent: true });
    streamingSessionIdRef.current = null;
    setData(undefined);
    void handleCreateNewChat(opts);
  }, [stopActiveStream, handleCreateNewChat, setData]);

  // 删除会话：删除【当前】会话时 hook 内部会切换到下一条会话（绕开 *Safe 包装），
  // 须同步清除 StreamData，与切换/新建保持同一「不跨会话串显」不变量；
  // 删除非当前会话不影响流式与用量显示，直接透传
  const handleDeleteSessionSafe = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      if (sessionId === currentSessionId) {
        streamingSessionIdRef.current = null;
        setData(undefined);
      }
      void handleDeleteSession(e, sessionId);
    },
    [handleDeleteSession, setData, currentSessionId]
  );

  // 分叉：从该消息复制前缀历史生成新会话（hook 内完成切换与落盘）
  const handleForkMessage = useCallback(
    (messageId: string) => {
      setData(undefined);
      void forkSession(messageId);
    },
    [forkSession, setData]
  );

  // 回滚重问：截断到该用户消息之前，消息内容回填输入框供修订后重发
  // （服务端同步清除 token 锚点，客户端 StreamData 中的旧峰值一并失效清除）
  const handleRewindMessage = useCallback(
    (messageId: string) => {
      const content = rewindSession(messageId);
      if (content) {
        setData(undefined);
        setInput(content);
      }
    },
    [rewindSession, setInput, setData]
  );

  // 推荐列表：方法卡 presetQuery（内置兜底 + 挂载后拉合并卡集覆盖）
  const presetQueries = useMethodologyPresets();

  // 推荐项只填入输入框不直接发送：用户可修改后自行提交
  // （提交时走常规 plan-first/execute 判定，与手输一致）
  const handlePresetSelect = useCallback(
    (msg: string) => {
      setInput(msg);
    },
    [setInput]
  );

  // ===== 看板收藏库交互（依赖 useChat 的 append/setInput，须在 useChat 之后定义）=====

  // 只读预览：点击查看时拉取完整记录（含 dsl）
  const [previewDashboard, setPreviewDashboard] = useState<DashboardRecord | null>(
    null
  );

  const handlePinDashboard = useCallback(
    (messageId: string, dsl: string, title?: string) => {
      const isCurrentlyPinned = canvasData?.id === messageId;
      if (isCurrentlyPinned) {
        setCanvasData(null);
        setViewMode("chat-only");
        toast("已取消画布钉选", "info");
      } else {
        setCanvasData({ id: messageId, title: title || "钉选看板", dsl });
        setViewMode("split");
        toast("已钉选至右侧协同画布", "success");
      }
    },
    [canvasData?.id]
  );

  const handlePreviewDashboard = useCallback(
    async (id: string) => {
      const record = await getDashboard(id);
      if (record) {
        setPreviewDashboard(record);
      } else {
        toast("看板不存在或已删除", "error");
      }
    },
    [getDashboard]
  );

  const handleCanvasRefresh = useCallback(
    async (id: string) => {
      const res = await refreshDashboardData(id);
      if (res.ok) {
        const rec = await getDashboard(id);
        if (rec) {
          setCanvasData({
            id: rec.id,
            title: rec.title,
            dsl: rec.dsl,
            isLive: (rec.queries?.length ?? 0) > 0,
          });
        }
        toast("画布数据已刷新", "success");
      } else {
        toast(res.error || "当前看板暂不支持自动重放刷新", "info");
      }
    },
    [refreshDashboardData, getDashboard]
  );

  const handleCanvasPrint = useCallback(() => {
    window.print();
  }, []);

  // 看板模板（M3-4）：存为模板/取消模板；用模板新建（换源选择，多源时序号输入）
  const handleToggleDashboardTemplate = useCallback(
    async (id: string) => {
      const result = await toggleDashboardTemplate(id);
      if (!result.ok) {
        toast(result.error ?? "操作失败", "error");
        return;
      }
      toast("模板状态已更新", "success");
    },
    [toggleDashboardTemplate]
  );

  const handleCreateDashboardFromTemplate = useCallback(
    async (templateId: string) => {
      const enabled = allDatasources.filter((src) => src.enabled !== false);
      if (enabled.length === 0) {
        toast("没有可用的数据源，请先在设置中启用", "error");
        return;
      }
      const picked =
        enabled.length === 1
          ? enabled[0].id
          : window.prompt(
              `选择目标数据源（输入序号）：\n${enabled
                .map((s, i) => `${i + 1}. ${s.name} (${s.id})`)
                .join("\n")}`
            );
      if (!picked) return;
      const idx = Number(picked);
      const targetSourceId =
        enabled.length === 1 ? enabled[0].id : enabled[idx - 1]?.id;
      if (!targetSourceId) {
        toast("无效的数据源序号", "error");
        return;
      }
      const result = await createDashboardFromTemplate(templateId, targetSourceId);
      if (!result.ok) {
        toast(result.error ?? "用模板新建失败", "error");
        return;
      }
      toast("已从模板创建新看板", "success");
      if (result.newId) {
        void handlePreviewDashboard(result.newId);
      }
    },
    [allDatasources, createDashboardFromTemplate, handlePreviewDashboard]
  );

  // 重新分析：优先回到看板原会话（上下文与数据源选择延续）；原会话已删除则
  // 明确报错终止——新建会话顶替会丢失原分析上下文，跑出的是另一份分析。
  // 直接塞进无关的当前活跃会话更不可取：其锁定的数据源可能不含看板原数据源
  // （服务端对未知源静默不装载工具），模型拿不到取数工具而失败
  const handleReanalyzeDashboard = useCallback(
    async (prompt?: string, originSessionId?: string) => {
      if (!prompt) {
        toast("该收藏未记录原始提问，请在输入框输入问题后发送", "info");
        return;
      }
      const origin = originSessionId
        ? sessions.find((s) => s.id === originSessionId)
        : undefined;

      if (originSessionId && !origin) {
        // 原会话已删除：无法恢复原上下文与数据源选择，终止并提示
        toast("原会话已删除，无法重新分析", "error");
        return;
      }

      let targetId: string | null = currentSessionId;
      let targetSources: string[] | undefined = activeSession?.enabledSources;
      // 提交意图确定：竖起「提交将发」标记，拦截切换渲染触发的重连探测
      pendingSubmitRef.current = true;
      if (origin && origin.id !== currentSessionId) {
        // 原会话仍在但不活跃：安全停流后切换。handleSelectSession 内部
        // setMessages 会同步更新 useChat 的 messagesRef，await 返回后立即
        // append 无竞态（消息不会拼到旧会话历史上）
        stopActiveStream({ silent: true });
        streamingSessionIdRef.current = null;
        await handleSelectSession(origin.id);
        targetId = origin.id;
        targetSources = origin.enabledSources;
      }
      // 其余情形（原会话即当前会话 / 导入快照无来源记录）：在当前会话重新分析
      if (!targetId) {
        pendingSubmitRef.current = false;
        toast("没有可用的会话，请稍后重试", "error");
        return;
      }

      // 显式按请求传 body：useChat 的 extraMetadataRef 要等重渲染才刷新，
      // 切会话后立即 append 必须覆盖 sources/sessionId，否则请求仍带旧会话的数据源
      streamingSessionIdRef.current = targetId;
      void Promise.resolve(
        append(
          { role: "user", content: prompt },
          { body: { sources: targetSources, sessionId: targetId } }
        )
      ).catch(() => {
        // 提交失败：isLoading 不会翻转，在此放下标记恢复后续重连能力
        pendingSubmitRef.current = false;
      });
      setPreviewDashboard(null);
    },
    [
      append,
      currentSessionId,
      activeSession?.enabledSources,
      sessions,
      stopActiveStream,
      handleSelectSession,
    ]
  );

  const handleRenameDashboard = useCallback(
    async (id: string, title: string) => {
      const ok = await renameDashboard(id, title);
      toast(ok ? "已重命名" : "重命名失败", ok ? "success" : "error");
      // 预览弹窗标题读的是打开时拉取的完整记录快照，rename 只刷新列表摘要，
      // 须同步回写预览记录，否则弹窗标题滞留在旧值（id 守卫：勿覆盖切换后的其他看板）
      if (ok) {
        setPreviewDashboard((prev) =>
          prev?.id === id ? { ...prev, title } : prev
        );
      }
    },
    [renameDashboard]
  );

  // 活看板数据刷新：重放 queries（零 LLM）→ 重新拉取完整记录（含新 dsl）回写预览。
  // 函数式回写 + id 匹配守卫：刷新期间用户关闭预览或切换到其他看板时，
  // 迟到的刷新结果不得重新打开/覆盖预览
  const handleRefreshDashboard = useCallback(
    async (id: string) => {
      const res = await refreshDashboardData(id);
      if (!res.ok) return res;
      const record = await getDashboard(id);
      if (!record) {
        return { ok: false as const, error: "刷新成功但获取最新看板失败" };
      }
      setPreviewDashboard((prev) => (prev?.id === id ? record : prev));
      return { ok: true as const, record, stale: res.stale };
    },
    [refreshDashboardData, getDashboard]
  );

  const handleDeleteDashboard = useCallback(
    async (id: string) => {
      const ok = await removeDashboard(id);
      toast(ok ? "已删除收藏" : "删除失败", ok ? "success" : "error");
      if (ok) setPreviewDashboard(null);
    },
    [removeDashboard]
  );

  // 导出快照：拉完整记录（含 dsl）→ 下载 <title>.openui.json
  const handleExportDashboard = useCallback(
    async (id: string) => {
      const record = await getDashboard(id);
      if (!record) {
        toast("看板不存在或已删除", "error");
        return;
      }
      try {
        await downloadDashboardSnapshot(record);
        toast("已导出快照", "success");
      } catch {
        toast("导出失败", "error");
      }
    },
    [getDashboard]
  );

  // 导入快照：客户端解析校验（JSON 可解析 + dsl 非空）→ 落库（origin 置空，视为手动导入）
  const handleImportDashboard = useCallback(
    async (file: File) => {
      const text = await file.text().catch(() => null);
      if (text === null) {
        toast("读取文件失败", "error");
        return;
      }
      const verdict = parseDashboardSnapshot(text);
      if (!verdict.ok) {
        toast(verdict.error, "error");
        return;
      }
      const res = await favoriteDashboard(verdict.value);
      if (res.ok) {
        toast("已导入看板库", "success");
      } else {
        toast(res.error || "导入失败", "error");
      }
    },
    [favoriteDashboard]
  );

  const handleDevToolsAction = useCallback((msg: string) => {
    toast(`触发 Action: ${msg}`, "info");
  }, []);

  // 预览看板的交互动作：注入输入框（不自动发送），并关闭预览让用户看到输入区
  const handlePreviewAction = useCallback(
    (actionPrompt: string) => {
      setInput(actionPrompt);
      setPreviewDashboard(null);
    },
    [setInput]
  );

  // 稳定回调：配合子组件 memo 化，避免每次渲染传递新闭包
  const handleToggleRawLang = useCallback(() => setShowRawLang((v) => !v), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), [setShowSettings]);
  const handleOpenDevTools = useCallback(() => setShowDevTools(true), []);
  const handleCloseDevTools = useCallback(() => setShowDevTools(false), []);
  const handleCloseSettings = useCallback(() => setShowSettings(false), [setShowSettings]);
  const handleCancelRename = useCallback(() => setEditingSessionId(null), [setEditingSessionId]);

  return (
    <div className="flex h-screen bg-surface-sunken text-foreground font-sans overflow-hidden">
      <ChatSidebar
        activeAppId={activeAppId}
        onSwitchApp={setActiveAppId}
        sessions={sessions}
        currentSessionId={currentSessionId}
        editingSessionId={editingSessionId}
        editingTitleText={editingTitleText}
        showRawLang={showRawLang}
        dashboards={dashboardSummaries}
        onPreviewDashboard={handlePreviewDashboard}
        onReanalyzeDashboard={handleReanalyzeDashboard}
        onRenameDashboard={handleRenameDashboard}
        onDeleteDashboard={handleDeleteDashboard}
        onExportDashboard={handleExportDashboard}
        onToggleDashboardTemplate={handleToggleDashboardTemplate}
        onCreateDashboardFromTemplate={handleCreateDashboardFromTemplate}
        onImportDashboard={handleImportDashboard}
        onCreateNewChat={handleCreateNewChatSafe}
        onSelectSession={handleSelectSessionSafe}
        onStartRename={handleStartRename}
        onSaveRename={handleSaveRename}
        onDeleteSession={handleDeleteSessionSafe}
        onEditTitleChange={setEditingTitleText}
        onPresetSelect={handlePresetSelect}
        presetQueries={presetQueries}
        onToggleRawLang={handleToggleRawLang}
        onOpenMethodology={() => setShowMethodology(true)}
        onOpenComponentCatalog={() => setShowComponentCatalog(true)}
        onCancelEdit={handleCancelRename}
      />

      {/* 主对话工作区 */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="h-14 border-b border-border bg-card px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-sm font-medium min-w-0">
            {activeApp.manifest.icon === "Bot" ? (
              <Bot className="w-4 h-4 text-info-fg shrink-0" />
            ) : (
              <TrendingUp className="w-4 h-4 text-info-fg shrink-0" />
            )}
            <span className="font-semibold truncate max-w-md">
              {activeSession?.title || activeApp.manifest.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 视图模式调节：仅当当前应用声明需要工作台插槽时暴露 */}
            {hasWorkspace && (
              <div className="hidden md:flex items-center bg-surface-sunken p-0.5 rounded-lg border border-border text-xs mr-1">
                <button
                  type="button"
                  onClick={() => setViewMode("chat-only")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    viewMode === "chat-only"
                      ? "bg-card text-foreground font-medium shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="纯对话视图"
                >
                  对话
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("split");
                    if (!canvasData) {
                      const lastBoard = [...messages]
                        .reverse()
                        .find((m) => m.role === "assistant" && /```openui/i.test(m.content || ""));
                      if (lastBoard) {
                        const extracted = extractOpenUI(lastBoard.content);
                        if (extracted.openuiPart) {
                          setCanvasData({
                            id: lastBoard.id,
                            title: "最新分析看板",
                            dsl: extracted.openuiPart,
                          });
                        }
                      }
                    }
                  }}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    viewMode === "split"
                      ? "bg-card text-foreground font-medium shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="双栏协同工作台"
                >
                  工作台
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("canvas-only")}
                  disabled={activeAppId === "analytics" && !canvasData}
                  className={`px-2 py-1 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    viewMode === "canvas-only"
                      ? "bg-card text-foreground font-medium shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={activeAppId === "analytics" ? "全屏画布视图" : "全屏工作台"}
                >
                  {activeAppId === "analytics" ? "画布" : "全屏"}
                </button>
              </div>
            )}

            {IS_DEV && (
              <button
                onClick={handleOpenDevTools}
                className="text-xs text-brand-fg hover:bg-brand-soft flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-brand-border"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>AST 沙箱</span>
              </button>
            )}
            <button
              onClick={handleOpenSettings}
              className="text-xs text-foreground-subtle hover:text-foreground flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>设置</span>
            </button>
            <Hint label="刷新页面">
              <button
                onClick={() => window.location.reload()}
                aria-label="刷新页面"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 p-1.5 rounded-md hover:bg-muted"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </Hint>
          </div>
        </header>

        {/* 工作台主体：支持纯对话、双栏协同与纯画布模式 */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 左侧对话工作流：在 canvas-only 模式下隐藏 */}
          {viewMode !== "canvas-only" && (
            <div
              className={`flex flex-col h-full min-w-0 transition-all duration-300 ${
                viewMode === "split"
                  ? "w-full md:w-1/2 lg:w-5/12 border-r border-border"
                  : "w-full"
              }`}
            >
              {sessionsLoaded ? (
                <MessageList
                  key={currentSessionId}
                  sessionId={currentSessionId}
                  messages={messages}
                  status={status}
                  error={error}
                  showRawLang={showRawLang}
                  activeSources={sessionSources}
                  onRendererAction={handleRendererAction}
                  onReload={reload}
                  onStop={handleStop}
                  favoritedMessageIds={favoritedMessageIds}
                  onFavoriteDashboard={handleFavoriteDashboard}
                  onForkMessage={handleForkMessage}
                  onRewindMessage={handleRewindMessage}
                  pinnedMessageId={canvasData?.id}
                  onPinDashboard={handlePinDashboard}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-foreground-faint">
                  正在加载会话…
                </div>
              )}

              <ChatInput
                input={input}
                isLoading={isLoading || !sessionsLoaded}
                mode={interactionMode}
                onModeChange={setInteractionMode}
                planMode={planMode}
                // AI SDK 的 handleInputChange 只读 e.target.value，事件源类型安全收敛到 textarea
                onChange={(e) =>
                  handleInputChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                }
                onSubmit={handleChatSubmit}
                onPlanModeChange={setPlanMode}
                onStop={handleStop}
                modelSwitcherNode={
                  <ModelSwitcher
                    providers={providers}
                    activeProviderId={activeProviderId}
                    activeModel={activeModel}
                    onSwitchModel={switchActiveModel}
                    onOpenSettings={handleOpenSettings}
                    variant="compact"
                  />
                }
                reasoningEffortNode={
                  <ReasoningEffortSwitcher
                    model={activeModel}
                    supportsReasoning={activeModelConfig?.supportsReasoning}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={setReasoningEffort}
                  />
                }
                sourcePickerNode={
                  InputAccessoryComponent ? (
                    <InputAccessoryComponent
                      sources={enabledPickerSources}
                      selected={activeSession?.enabledSources}
                      onChange={handleSourcesChange}
                      disabled={sourcesLocked}
                    />
                  ) : null
                }
                contextUsageNode={
                  <ContextUsageIndicator
                    promptTokens={contextUsage.promptTokens}
                    window={contextUsage.window}
                    cumulativeTokens={cumulativeStats.totalTokens}
                    cumulativeCostUsd={cumulativeStats.costUsd}
                  />
                }
              />
            </div>
          )}

          {/* 右侧扩展工作台插槽：仅当当前应用声明需要工作台插槽且有插槽组件、处于展开态时渲染 */}
          {hasWorkspace && viewMode !== "chat-only" && WorkspaceComponent && (
            <div
              className={`flex flex-col h-full min-w-0 transition-all duration-300 ${
                viewMode === "canvas-only" ? "w-full" : "hidden md:flex flex-1"
              }`}
            >
              <WorkspaceComponent
                data={canvasData}
                sessionId={currentSessionId}
                appId={activeAppId}
                onClose={() => setViewMode("chat-only")}
                onAction={handleRendererAction}
                onRefresh={handleCanvasRefresh}
                onPrint={handleCanvasPrint}
                isExpanded={viewMode === "canvas-only"}
                onToggleExpand={() =>
                  setViewMode((prev) =>
                    prev === "canvas-only" ? "split" : "canvas-only"
                  )
                }
              />
            </div>
          )}
        </div>
      </main>

      {showDevTools && (
        <DevToolsPanel
          code={devToolsCode}
          onCodeChange={setDevToolsCode}
          onAction={handleDevToolsAction}
          onClose={handleCloseDevTools}
        />
      )}

      {/* 收藏看板只读预览 */}
      <DashboardPreviewModal
        dashboard={previewDashboard}
        onClose={() => setPreviewDashboard(null)}
        onReanalyze={handleReanalyzeDashboard}
        onRename={handleRenameDashboard}
        onDelete={handleDeleteDashboard}
        onAction={handlePreviewAction}
        onRefresh={handleRefreshDashboard}
        onPinToCanvas={handlePinDashboard}
      />

      {/* 分析方法论查看（合并卡集：内置 + 用户覆盖） */}
      <MethodologyModal
        open={showMethodology}
        onClose={() => setShowMethodology(false)}
      />

      {/* 可视化组件查看（目录与组件库同源） */}
      <ComponentCatalogModal
        open={showComponentCatalog}
        onClose={() => setShowComponentCatalog(false)}
      />

      {showSettings && (
        <SettingsModal
          providers={providers}
          activeProviderId={activeProviderId}
          activeModel={activeModel}
          onSaveProvider={saveProvider}
          onDeleteProvider={deleteProvider}
          onSwitchActiveModel={switchActiveModel}
          providerId={providerId}
          apiKey={apiKey}
          baseURL={baseURL}
          model={model}
          accessToken={accessToken}
          temperature={temperature}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          maxTokens={maxTokens}
          maxSteps={maxSteps}
          contextWindow={contextWindow}
          fallbackModels={fallbackModels}
          protocol={protocol}
          onProviderChange={applyProvider}
          onApiKeyChange={setApiKey}
          onBaseURLChange={setBaseURL}
          onModelChange={setModel}
          onAccessTokenChange={setAccessToken}
          onTemperatureChange={setTemperature}
          onMaxTokensChange={setMaxTokens}
          onMaxStepsChange={setMaxSteps}
          onContextWindowChange={setContextWindow}
          onFallbackModelsChange={setFallbackModels}
          onProtocolChange={setProtocol}
          onSave={saveSettings}
          onClose={handleCloseSettings}
        />
      )}

      <Toaster />
    </div>
  );
}
