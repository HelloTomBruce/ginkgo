"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { TrendingUp, Code2, Settings, RefreshCw } from "lucide-react";
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
import { SourcePicker } from "@/components/chat/SourcePicker";
import { useDatasourceList } from "@/components/chat/datasources/useDatasources";
import { useMethodologyPresets } from "@/components/chat/useMethodologyPresets";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { ModelSwitcher } from "@/components/chat/ModelSwitcher";
import { DevToolsPanel } from "@/components/chat/DevToolsPanel";
import { MethodologyModal } from "@/components/chat/MethodologyModal";
import { ComponentCatalogModal } from "@/components/chat/ComponentCatalogModal";
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

  const {
    showSettings,
    setShowSettings,
    providers,
    activeProviderId,
    activeModel,
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
    maxTokens,
    setMaxTokens,
    maxSteps,
    setMaxSteps,
    contextWindow,
    setContextWindow,
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
  } = useSessionManager({
    getWelcomeContext: () => ({
      sources: welcomeSourcesRef.current
        .filter((s) => s.enabled !== false)
        .map((s) => ({ id: s.id, name: s.name })),
      features: welcomeFeaturesRef.current,
    }),
  });

  const handleChatError = useCallback((err: Error) => {
    console.error("Chat error:", err);
  }, []);

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
      sources: activeSession?.enabledSources,
      // 上下文治理：服务端按会话读写 token 锚点与摘要缓存
      sessionId: currentSessionId || undefined,
    }),
    [chatBody, activeSession?.enabledSources, currentSessionId]
  );
  // 当前会话实际启用的源（名称+id）：驱动加载提示与工具归因展示；useMemo 保 MessageItem memo 生效
  const sessionSources = useMemo(() => {
    const sel = activeSession?.enabledSources;
    const list = sel
      ? enabledPickerSources.filter((s) => sel.includes(s.id))
      : enabledPickerSources;
    return list.map((s) => ({ id: s.id, name: s.name }));
  }, [enabledPickerSources, activeSession?.enabledSources]);

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
  } = useChat({
    api: "/api/analyze",
    body: chatBodyWithSources,
    headers: authHeaders(),
    onError: handleChatError,
    initialMessages: [DEFAULT_WELCOME_MESSAGE],
    onFinish: (message, options) => {
      // 流式结束时保存：用 getMessages() 读取最新列表（含多步工具调用的中间消息），
      // upsert 防止与 AI SDK 已合入的最终消息重复；写回发起请求时的会话。
      // 仅在仍持有流式会话标记时落盘——标记被清空（切换/新建已停流）说明
      // 这条 finish 属于旧会话，静默丢弃，防止把 A 会话内容写进 B。
      const targetId = streamingSessionIdRef.current;
      // 上下文用量：记录兜底值（当 StreamData 可用时优先消费真实单步值）
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
          targetId,
          validTokens ? { promptTokens: validTokens } : undefined
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
  useEffect(() => {
    isLoadingRef.current = isLoading;
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
        const data = (await res.json()) as { running?: boolean };
        // 双重复查：cancelled（effect 已被更新取代）或 isLoadingRef（用户刚提交）
        // 任一命中都放弃重连
        if (cancelled || !data.running || isLoadingRef.current) return;
        streamingSessionIdRef.current = currentSessionId;
        void reload({ body: { ...nextModeBody(), reconnect: true } });
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

  // 中止在途流并即刻落盘当前会话（silent=true 时不提示，供切换/新建会话前调用）
  const stopActiveStream = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!isLoading) return;
      const activeId = streamingSessionIdRef.current;
      stop();
      if (activeId) {
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

  // 暂停/中止当前会话生成（保留已有内容并即刻持久化）
  const handleStop = useCallback(() => stopActiveStream(), [stopActiveStream]);

  // 切换/新建会话前必先停流并清空流式会话标记：
  // 否则节流落盘与 onFinish 仍指向旧会话 A，会把新会话 B 的消息写进 A
  const handleSelectSessionSafe = useCallback(
    (sessionId: string) => {
      stopActiveStream({ silent: true });
      streamingSessionIdRef.current = null;
      void handleSelectSession(sessionId);
    },
    [stopActiveStream, handleSelectSession]
  );

  const handleCreateNewChatSafe = useCallback(() => {
    stopActiveStream({ silent: true });
    streamingSessionIdRef.current = null;
    void handleCreateNewChat();
  }, [stopActiveStream, handleCreateNewChat]);

  // 分叉：从该消息复制前缀历史生成新会话（hook 内完成切换与落盘）
  const handleForkMessage = useCallback(
    (messageId: string) => {
      void forkSession(messageId);
    },
    [forkSession]
  );

  // 回滚重问：截断到该用户消息之前，消息内容回填输入框供修订后重发
  const handleRewindMessage = useCallback(
    (messageId: string) => {
      const content = rewindSession(messageId);
      if (content) setInput(content);
    },
    [rewindSession, setInput]
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

  // 重新分析：原始提问作为新用户消息进入当前会话（沿用预设场景的直出模式与当前会话源设置）
  const handleReanalyzeDashboard = useCallback(
    (prompt?: string) => {
      if (!prompt) {
        toast("该收藏未记录原始提问，请在输入框输入问题后发送", "info");
        return;
      }
      streamingSessionIdRef.current = currentSessionId;
      append({ role: "user", content: prompt });
      setPreviewDashboard(null);
    },
    [append, currentSessionId]
  );

  const handleRenameDashboard = useCallback(
    async (id: string, title: string) => {
      const ok = await renameDashboard(id, title);
      toast(ok ? "已重命名" : "重命名失败", ok ? "success" : "error");
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
        sessions={sessions}
        currentSessionId={currentSessionId}
        editingSessionId={editingSessionId}
        editingTitleText={editingTitleText}
        apiKey={apiKey}
        model={model}
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
        onDeleteSession={handleDeleteSession}
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
            <TrendingUp className="w-4 h-4 text-info-fg shrink-0" />
            <span className="font-semibold truncate max-w-md">
              {activeSession?.title || "OpenUI 对话式数据分析看板"}
            </span>
            <ModelSwitcher
              providers={providers}
              activeProviderId={activeProviderId}
              activeModel={activeModel}
              onSwitchModel={switchActiveModel}
              onOpenSettings={handleOpenSettings}
              variant="header"
            />
          </div>
          <div className="flex items-center gap-2">
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
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-foreground-faint">
            正在加载会话…
          </div>
        )}

        <SourcePicker
          sources={enabledPickerSources}
          selected={activeSession?.enabledSources}
          onChange={handleSourcesChange}
          disabled={sourcesLocked}
        />

        {/* 上下文用量条：常驻展示当前会话 promptTokens / 模型窗口；>70% 黄、>90% 红 */}
        <div className="px-6 pb-1.5 flex items-center gap-2 text-[10px] text-foreground-faint select-none">
          <span className="shrink-0">上下文</span>
          <div className="w-32 h-1 rounded-full bg-surface-raised overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                (contextUsage.promptTokens / contextUsage.window) > 0.9
                  ? "bg-danger-solid"
                  : (contextUsage.promptTokens / contextUsage.window) > 0.7
                    ? "bg-warning-solid"
                    : "bg-success-solid"
              }`}
              style={{
                width: `${Math.min(100, Math.round((contextUsage.promptTokens / contextUsage.window) * 100))}%`,
              }}
            />
          </div>
          <span className="shrink-0 tabular-nums">
            {`${(contextUsage.promptTokens / 1000).toFixed(1)}k / ${Math.round(contextUsage.window / 1000)}k（${Math.round((contextUsage.promptTokens / contextUsage.window) * 100)}%）`}
          </span>
        </div>

        <ChatInput
          input={input}
          isLoading={isLoading || !sessionsLoaded}
          planMode={planMode}
          // AI SDK 的 handleInputChange 只读 e.target.value，事件源类型安全收敛到 textarea
          onChange={(e) => handleInputChange(e as unknown as React.ChangeEvent<HTMLInputElement>)}
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
        />
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
          maxTokens={maxTokens}
          maxSteps={maxSteps}
          contextWindow={contextWindow}
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
          onProtocolChange={setProtocol}
          onSave={saveSettings}
          onClose={handleCloseSettings}
        />
      )}

      <Toaster />
    </div>
  );
}
