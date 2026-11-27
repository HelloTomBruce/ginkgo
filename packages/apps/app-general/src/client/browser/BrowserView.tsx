"use client";

/**
 * 浏览器自动化操作与状态视图（多维工作台「浏览器」Tab 的自持垂直切片）。
 * 自持状态：操作流水、截图列表、选中态、详情视图与全屏预览；
 * 数据源：宿主流式注入的 liveOps（优先）+ 服务端持久化记录（回退）。
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Globe,
  Camera,
  ExternalLink,
  Maximize2,
  Download,
  Search,
  RotateCcw,
  X,
} from "lucide-react";
import type { AppSessionDetailProjection, AppWorkspaceMessage } from "@ginkgolab/app-sdk";
import {
  buildRawFileUrl,
  extractBrowserOperations,
  messagesExtractionSignature,
  getBrowserToolMeta,
  type BrowserOperationItem,
} from "./browserOps";

export interface BrowserScreenshotItem {
  name: string;
  path: string;
  updatedAt: number;
}

export interface BrowserViewProps {
  appId: string;
  sessionId: string;
  /** 宿主流式注入的会话消息（实时提取 browser_* 操作流水） */
  messages?: AppWorkspaceMessage[];
  /** 是否正在流式生成（驱动 2s 心跳轮询与完成后对账刷新） */
  isStreaming?: boolean;
  /** 操作流水数量回调（供宿主 Tab 徽标展示） */
  onOperationsCountChange?: (count: number) => void;
}

export function BrowserView({
  appId,
  sessionId,
  messages,
  isStreaming,
  onOperationsCountChange,
}: BrowserViewProps) {
  const [serverOperations, setServerOperations] = useState<BrowserOperationItem[]>([]);
  const [userSelectedOpId, setUserSelectedOpId] = useState<string | null>(null);
  const [browserScreenshots, setBrowserScreenshots] = useState<BrowserScreenshotItem[]>([]);
  const [userSelectedScreenshotPath, setUserSelectedScreenshotPath] = useState<string | null>(null);
  const [browserStatusLoading, setBrowserStatusLoading] = useState(false);
  const [browserDetailView, setBrowserDetailView] = useState<"screenshot" | "data">("screenshot");
  const [isZoomedScreenshot, setIsZoomedScreenshot] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotTimestamp, setScreenshotTimestamp] = useState<number>(0);

  // 1. 实时提取宿主流式注入的 liveOps（内存级，随消息流渲染即刻更新）。
  // 流式热路径优化：每 chunk 消息引用必变，但提取输出只在签名变化时才会变——
  // 以 O(末条消息) 的廉价签名做 memo 依赖，避免逐 token 全量重提取。
  const messagesList = useMemo(() => messages ?? [], [messages]);
  const messagesSignature = useMemo(
    () => messagesExtractionSignature(messagesList),
    [messagesList]
  );
  const liveOps = useMemo(() => {
    if (messagesSignature === "empty") return [];
    return extractBrowserOperations(messagesList);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖签名而非引用：签名不变即跳过重提取
  }, [messagesSignature]);

  // 2. 最终生效的操作流水：优先使用实时消息流，无消息流时回退到服务端持久化记录
  const browserOperations = useMemo(() => {
    if (liveOps.length > 0) return liveOps;
    return serverOperations;
  }, [liveOps, serverOperations]);

  // 3. 当前选中的操作 ID（有用户手动点击则以用户点击为准，否则默认高亮最后一步）
  const selectedOpId = useMemo(() => {
    if (userSelectedOpId && browserOperations.some((o) => o.id === userSelectedOpId)) {
      return userSelectedOpId;
    }
    return browserOperations.length > 0 ? browserOperations[browserOperations.length - 1].id : null;
  }, [userSelectedOpId, browserOperations]);

  // 4. 当前展示的截图路径（优先用户选中的，否则自动追踪最新操作的截图或落盘第一张截图）
  const activeScreenshotPath = useMemo(() => {
    if (userSelectedScreenshotPath) return userSelectedScreenshotPath;
    const lastShot = [...browserOperations].reverse().find((o) => o.screenshotPath);
    if (lastShot?.screenshotPath) return lastShot.screenshotPath;
    if (browserScreenshots.length > 0) return browserScreenshots[0].path;
    return null;
  }, [userSelectedScreenshotPath, browserOperations, browserScreenshots]);

  const currentBrowserUrl = useMemo(() => {
    for (let i = browserOperations.length - 1; i >= 0; i--) {
      if (browserOperations[i].url) return browserOperations[i].url;
    }
    return null;
  }, [browserOperations]);

  const currentBrowserTitle = useMemo(() => {
    for (let i = browserOperations.length - 1; i >= 0; i--) {
      if (browserOperations[i].title) return browserOperations[i].title;
    }
    return null;
  }, [browserOperations]);

  const selectedOp = useMemo(
    () =>
      browserOperations.find((o) => o.id === selectedOpId) ||
      browserOperations[browserOperations.length - 1] ||
      null,
    [browserOperations, selectedOpId]
  );

  // 加载浏览器操作流水与工作区截图产物
  const fetchBrowserStatus = useCallback(async () => {
    try {
      setBrowserStatusLoading(true);
      // 1. 获取会话消息并提取所有 browser_* 工具流水（响应形状走协议投影契约）
      const sessRes = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (sessRes.ok) {
        const sessData = (await sessRes.json()) as AppSessionDetailProjection;
        setServerOperations(extractBrowserOperations(sessData?.session?.messages ?? []));
      }

      // 2. 调用 /api/apps/general/action 获取工作区落盘的截图列表
      const actRes = await fetch(`/api/apps/${encodeURIComponent(appId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "browser_status",
          sessionId,
        }),
      });
      if (actRes.ok) {
        const actData = await actRes.json();
        if (Array.isArray(actData.screenshots)) {
          setBrowserScreenshots(actData.screenshots);
          if (actData.screenshots.length > 0) {
            setScreenshotTimestamp(Date.now());
          }
        }
      }
    } catch (err) {
      console.error("[BrowserView] 加载浏览器状态失败:", err);
    } finally {
      setBrowserStatusLoading(false);
    }
  }, [sessionId, appId]);

  // 手动截取当前浏览器画面
  const handleCaptureScreenshot = useCallback(async () => {
    try {
      setIsCapturingScreenshot(true);
      const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "browser_capture_screenshot",
          sessionId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.screenshot?.path) {
          setUserSelectedScreenshotPath(data.screenshot.path);
          setScreenshotTimestamp(Date.now());
          void fetchBrowserStatus();
        }
      }
    } catch (err) {
      console.error("[BrowserView] 截图失败:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [appId, sessionId, fetchBrowserStatus]);

  // 挂载即加载一次（本组件仅在浏览器 Tab 激活时挂载，等价于原「切换 Tab 触发刷新」）
  useEffect(() => {
    void (async () => {
      await fetchBrowserStatus();
    })();
  }, [fetchBrowserStatus]);

  // 流式完成瞬间（isStreaming true -> false）自动对账刷新
  const prevStreamingRef = useRef(Boolean(isStreaming));
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      void fetchBrowserStatus();
    }
    prevStreamingRef.current = Boolean(isStreaming);
  }, [isStreaming, fetchBrowserStatus]);

  // 流式生成中的 2 秒心跳轮询，确保磁盘落盘文件秒级同步
  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => {
      void fetchBrowserStatus();
    }, 2000);
    return () => clearInterval(timer);
  }, [isStreaming, fetchBrowserStatus]);

  // 向宿主上报操作流水数量（Tab 徽标）
  useEffect(() => {
    onOperationsCountChange?.(browserOperations.length);
  }, [browserOperations.length, onOperationsCountChange]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
      {/* 顶部模拟浏览器导航与地址栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/60 shrink-0">
        <div className="flex items-center gap-1 text-foreground-faint">
          <Globe className="w-4 h-4 text-brand-fg shrink-0" />
        </div>

        {/* 模拟 URL 地址栏 */}
        <div className="flex items-center gap-2 flex-1 min-w-0 bg-surface-sunken border border-border rounded-lg px-2.5 py-1 text-xs">
          <span className="text-foreground-faint select-none">URL:</span>
          <span className="font-mono text-foreground truncate select-all flex-1">
            {currentBrowserUrl || "未打开任何网页（等待会话浏览器交互）"}
          </span>
          {currentBrowserUrl && (
            <a
              href={currentBrowserUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="p-1 text-foreground-subtle hover:text-brand-fg transition-colors shrink-0"
              title="在新标签页中访问该网页"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* 运行状态胶囊 */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] bg-surface-sunken border border-border shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              browserOperations.length > 0 ? "bg-success-fg animate-pulse" : "bg-foreground-faint"
            }`}
          />
          <span className="text-foreground-subtle font-medium truncate max-w-[160px]">
            {currentBrowserTitle || (browserOperations.length > 0 ? "浏览器已连接" : "浏览器就绪")}
          </span>
        </div>

        {/* 刷新状态按钮 */}
        <button
          type="button"
          onClick={() => {
            void fetchBrowserStatus();
          }}
          disabled={browserStatusLoading}
          className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md border border-border bg-card transition-colors shrink-0 cursor-pointer shadow-xs"
          title="刷新浏览器状态与操作流水"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${browserStatusLoading ? "animate-spin" : ""}`} />
        </button>

        {/* 手动快速截图按钮 */}
        <button
          type="button"
          onClick={handleCaptureScreenshot}
          disabled={isCapturingScreenshot || browserStatusLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-colors disabled:opacity-50 shrink-0 cursor-pointer shadow-xs"
          title="立即截取当前网页画面并刷新视图"
        >
          <Camera className={`w-3.5 h-3.5 text-success-fg ${isCapturingScreenshot ? "animate-pulse" : ""}`} />
          <span>{isCapturingScreenshot ? "截屏中..." : "截取画面"}</span>
        </button>
      </div>

      {/* 主内容区域：若暂无操作展示引导空态，有操作展示左右分栏 */}
      {browserOperations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-foreground-subtle">
          <div className="w-14 h-14 rounded-2xl bg-brand-soft flex items-center justify-center text-brand-fg mb-3 shadow-xs">
            <Globe className="w-7 h-7 stroke-[1.4]" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">浏览器自动化协同已就绪</h3>
          <p className="text-xs text-foreground-subtle max-w-md mb-6 leading-relaxed">
            在对话框向通用智能助手发送网页浏览、信息提取、截图或表单交互指令。
            AI 调用浏览器工具执行的每一步操作流水与实时画面将同步呈现在此。
          </p>

          {/* 常用建议卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg w-full text-left">
            <div className="p-3 rounded-lg border border-border bg-card/60 hover:bg-card hover:border-brand-border transition-colors">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1">
                <Search className="w-3.5 h-3.5 text-brand-fg" />
                <span>抓取与热点总结</span>
              </div>
              <p className="text-[11px] text-foreground-subtle">
                “打开 https://news.ycombinator.com 总结今日前三热点”
              </p>
            </div>

            <div className="p-3 rounded-lg border border-border bg-card/60 hover:bg-card hover:border-brand-border transition-colors">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1">
                <Camera className="w-3.5 h-3.5 text-success-fg" />
                <span>网页视口截图</span>
              </div>
              <p className="text-[11px] text-foreground-subtle">
                “打开 example.com 并截取首屏高清图像”
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
          {/* 左栏：操作流水时间线 */}
          <div className="w-72 border-r border-border flex flex-col min-h-0 bg-card/40 shrink-0">
            <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between text-xs font-medium text-foreground-subtle">
              <span>操作步骤流水</span>
              <span className="text-[11px] text-foreground-faint font-normal font-mono">
                {browserOperations.length} 次调用
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {browserOperations.map((op, idx) => {
                const meta = getBrowserToolMeta(op.toolName);
                const Icon = meta.icon;
                const isSelected = selectedOp?.id === op.id;

                return (
                  <div
                    key={`${op.id}-${idx}`}
                    onClick={() => {
                      setUserSelectedOpId(op.id);
                      if (op.screenshotPath) {
                        setUserSelectedScreenshotPath(op.screenshotPath);
                      }
                    }}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all select-none ${
                      isSelected
                        ? "bg-brand-soft border-brand-border text-brand-fg shadow-xs"
                        : "bg-card border-border hover:border-foreground-subtle/40 text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] font-mono text-foreground-faint">
                          #{idx + 1}
                        </span>
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.color}`} />
                        <span className="font-semibold truncate">{meta.label}</span>
                      </div>
                      <span className="text-[10px] text-foreground-faint font-mono shrink-0">
                        {op.toolName}
                      </span>
                    </div>

                    {/* 简要参数预览 */}
                    {op.url && (
                      <p className="text-[11px] text-foreground-subtle truncate font-mono">
                        {op.url}
                      </p>
                    )}
                    {op.what && (
                      <p className="text-[11px] text-foreground-subtle truncate">
                        目标: <span className="font-medium text-foreground">{op.what}</span>
                      </p>
                    )}
                    {op.screenshotPath && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-success-fg">
                        <Camera className="w-3 h-3" />
                        <span>含截图产物</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右栏：检查器与截图视图 */}
          <div className="flex-1 flex flex-col min-w-0 bg-surface-sunken overflow-hidden">
            {/* 子视图切换：截图画面 vs 参数与输出 */}
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-card/60">
              <div className="flex items-center gap-1 bg-surface-sunken p-0.5 rounded-md border border-border text-xs">
                <button
                  type="button"
                  onClick={() => setBrowserDetailView("screenshot")}
                  className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 font-medium ${
                    browserDetailView === "screenshot"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-foreground-subtle hover:text-foreground"
                  }`}
                >
                  <Camera className="w-3 h-3 text-success-fg" />
                  <span>截图预览</span>
                  {browserScreenshots.length > 0 && (
                    <span className="text-[10px] bg-muted px-1 rounded-full">
                      {browserScreenshots.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setBrowserDetailView("data")}
                  className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 font-medium ${
                    browserDetailView === "data"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-foreground-subtle hover:text-foreground"
                  }`}
                >
                  <Search className="w-3 h-3 text-brand-fg" />
                  <span>参数与结果</span>
                </button>
              </div>

              {activeScreenshotPath && browserDetailView === "screenshot" && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsZoomedScreenshot(true)}
                    className="flex items-center gap-1 text-foreground-subtle hover:text-foreground transition-colors cursor-pointer"
                    title="全屏放大查看"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>全屏</span>
                  </button>
                  <a
                    href={buildRawFileUrl(appId, sessionId, activeScreenshotPath)}
                    download
                    className="flex items-center gap-1 text-foreground-subtle hover:text-foreground transition-colors cursor-pointer"
                    title="下载截图"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载</span>
                  </a>
                </div>
              )}
            </div>

            {/* 视图内容 */}
            <div className="flex-1 overflow-y-auto p-4">
              {browserDetailView === "screenshot" ? (
                activeScreenshotPath ? (
                  <div className="space-y-3">
                    <div className="relative rounded-lg overflow-hidden border border-border bg-card shadow-xs group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={buildRawFileUrl(appId, sessionId, activeScreenshotPath, screenshotTimestamp || undefined)}
                        alt="网页实时截图"
                        className="w-full h-auto object-contain max-h-[60vh] mx-auto block cursor-zoom-in"
                        onClick={() => setIsZoomedScreenshot(true)}
                      />
                      <div className="p-2 border-t border-border bg-card/80 text-[11px] text-foreground-subtle flex items-center justify-between">
                        <span className="font-mono">{activeScreenshotPath}</span>
                        <span>点击图片可全屏放大</span>
                      </div>
                    </div>

                    {/* 历史截图缩略图行 */}
                    {browserScreenshots.length > 1 && (
                      <div>
                        <p className="text-xs font-medium text-foreground-subtle mb-2">
                          会话历史截图 ({browserScreenshots.length})
                        </p>
                        <div className="flex items-center gap-2 overflow-x-auto pb-2">
                          {browserScreenshots.map((shot) => (
                            <button
                              key={shot.path}
                              type="button"
                              onClick={() => setUserSelectedScreenshotPath(shot.path)}
                              className={`relative w-20 h-14 rounded-md overflow-hidden border shrink-0 transition-all ${
                                activeScreenshotPath === shot.path
                                  ? "ring-2 ring-brand-border border-brand-solid"
                                  : "border-border hover:border-foreground-subtle"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={buildRawFileUrl(appId, sessionId, shot.path, screenshotTimestamp || undefined)}
                                alt={shot.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-foreground-subtle">
                    <Camera className="w-10 h-10 mb-2 stroke-[1.2] text-foreground-faint" />
                    <p className="text-xs font-medium text-foreground mb-1">暂无页面截图</p>
                    <p className="text-[11px] text-foreground-faint max-w-xs mb-4">
                      助手执行 browser_screenshot 工具时生成的快照将在此展示；您也可以立即截取当前网页画面。
                    </p>
                    <button
                      type="button"
                      onClick={handleCaptureScreenshot}
                      disabled={isCapturingScreenshot || browserStatusLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-solid text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer shadow-xs"
                    >
                      <Camera className={`w-3.5 h-3.5 ${isCapturingScreenshot ? "animate-pulse" : ""}`} />
                      <span>{isCapturingScreenshot ? "正在截取页面..." : "📸 立即截取当前画面"}</span>
                    </button>
                  </div>
                )
              ) : (
                selectedOp ? (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span>工具调用信息</span>
                        <span className="font-mono text-brand-fg bg-brand-soft px-1.5 py-0.5 rounded text-[11px]">
                          {selectedOp.toolName}
                        </span>
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        {selectedOp.url && (
                          <div className="flex gap-2">
                            <span className="text-foreground-faint w-16 shrink-0">页面 URL:</span>
                            <span className="font-mono text-foreground break-all select-all">
                              {selectedOp.url}
                            </span>
                          </div>
                        )}
                        {selectedOp.what && (
                          <div className="flex gap-2">
                            <span className="text-foreground-faint w-16 shrink-0">意图/目标:</span>
                            <span className="text-foreground font-medium">{selectedOp.what}</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <span className="text-foreground-faint w-16 shrink-0">调用状态:</span>
                          <span className="text-success-fg font-medium">
                            {selectedOp.state === "result" ? "已完成" : "调用中"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-border bg-card">
                      <h4 className="text-xs font-semibold text-foreground mb-1.5">
                        输入参数 (Arguments)
                      </h4>
                      <pre className="p-2.5 rounded bg-surface-sunken border border-border text-[11px] font-mono text-foreground overflow-x-auto">
                        {JSON.stringify(selectedOp.args || {}, null, 2)}
                      </pre>
                    </div>

                    <div className="p-3 rounded-lg border border-border bg-card">
                      <h4 className="text-xs font-semibold text-foreground mb-1.5">
                        返回结果 (Result)
                      </h4>
                      <pre className="p-2.5 rounded bg-surface-sunken border border-border text-[11px] font-mono text-foreground overflow-x-auto max-h-72">
                        {typeof selectedOp.result === "string"
                          ? selectedOp.result
                          : JSON.stringify(selectedOp.result || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-foreground-subtle">
                    请在左侧选择一个操作步骤查看明细
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* 全屏大图 Modal */}
      {isZoomedScreenshot && activeScreenshotPath && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setIsZoomedScreenshot(false)}
        >
          <div
            className="relative max-w-6xl max-h-[90vh] bg-card rounded-xl overflow-hidden border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-border bg-card/90 flex items-center justify-between">
              <span className="text-xs font-mono text-foreground truncate">
                {activeScreenshotPath}
              </span>
              <button
                type="button"
                onClick={() => setIsZoomedScreenshot(false)}
                className="p-1 rounded-md text-foreground-subtle hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 overflow-auto max-h-[82vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={buildRawFileUrl(appId, sessionId, activeScreenshotPath)}
                alt="网页高清截图"
                className="w-full h-auto object-contain block rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
