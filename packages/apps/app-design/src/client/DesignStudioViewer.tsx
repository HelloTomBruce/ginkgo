"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Palette,
  Laptop,
  Tablet,
  Smartphone,
  RotateCw,
  ExternalLink,
  Play,
  Square,
  ShieldCheck,
  FileCode,
  Layers,
  Sparkles,
  Maximize2,
  Minimize2,
  X,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export type DesignStudioTab = "canvas" | "system" | "files";

export interface DesignStudioViewerProps {
  workspace?: {
    id: string;
    name: string;
    path: string;
  };
  sessionId?: string;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function DesignStudioViewer({
  workspace,
  onClose,
  isExpanded = false,
  onToggleExpand,
}: DesignStudioViewerProps) {
  const [activeTab, setActiveTab] = useState<DesignStudioTab>("canvas");
  const [viewportWidth, setViewportWidth] = useState<string>("100%");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [canvasTitle, setCanvasTitle] = useState<string>("画板");
  const [boardCount, setBoardCount] = useState<number>(0);
  const [hasCanvas, setHasCanvas] = useState<boolean>(false);
  const [hasDesignSystem, setHasDesignSystem] = useState<boolean>(false);
  const [designSystemData, setDesignSystemData] = useState<Record<string, unknown> | null>(null);
  const [auditReport, setAuditReport] = useState<string | null>(null);
  const [auditPassed, setAuditPassed] = useState<boolean | null>(null);
  const [files, setFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const workspacePath = workspace?.path || "";

  // 1. 加载设计状态
  const loadDesignStatus = useCallback(async () => {
    if (!workspacePath) return;
    try {
      setIsLoading(true);
      const res = await fetch(`/api/design?workspacePath=${encodeURIComponent(workspacePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      setHasCanvas(Boolean(data.hasCanvas));
      if (data.canvasTitle) setCanvasTitle(data.canvasTitle);
      setBoardCount(data.boardCount || 0);
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
      setHasDesignSystem(Boolean(data.hasDesignSystem));
      if (data.designSystem) setDesignSystemData(data.designSystem);
    } catch (err) {
      console.error("Failed to load design status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);

  // 2. 加载工作区文件树
  const loadFiles = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const res = await fetch(`/api/workspace?action=tree&workspacePath=${encodeURIComponent(workspacePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.files)) {
        // 筛选 project/ 目录下的文件或关键文件
        const projectFiles = data.files.filter(
          (f: { path: string }) =>
            f.path.includes("project/") ||
            f.path.endsWith(".dc.html") ||
            f.path.endsWith("canvas.json") ||
            f.path.endsWith("design-system.json")
        );
        setFiles(projectFiles.length > 0 ? projectFiles : data.files.slice(0, 30));
        if (!selectedFile && projectFiles.length > 0) {
          setSelectedFile(projectFiles[0].path);
        }
      }
    } catch {
      // ignore
    }
  }, [workspacePath, selectedFile]);

  // 3. 读取单个文件内容
  const loadFileContent = useCallback(
    async (filePath: string) => {
      if (!workspacePath) return;
      try {
        const res = await fetch(
          `/api/workspace?action=file&filePath=${encodeURIComponent(filePath)}&workspacePath=${encodeURIComponent(workspacePath)}`
        );
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content || "");
        }
      } catch {
        setFileContent("");
      }
    },
    [workspacePath]
  );

  // 初始化加载
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (!isCancelled) {
        await loadDesignStatus();
        await loadFiles();
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [loadDesignStatus, loadFiles]);

  // 读取选中文件的内容
  useEffect(() => {
    let isCancelled = false;
    if (!selectedFile) return;
    void (async () => {
      if (!isCancelled) {
        await loadFileContent(selectedFile);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [selectedFile, loadFileContent]);

  // 4. 启动预览服务
  const handleStartServe = async () => {
    if (!workspacePath) return;
    try {
      setIsLoading(true);
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "serve", workspacePath }),
      });
      const data = await res.json();
      if (data.url) {
        setPreviewUrl(data.url);
      }
    } catch (err) {
      console.error("Failed to start serve:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // 5. 停止预览服务
  const handleStopServe = async () => {
    if (!workspacePath) return;
    try {
      setIsLoading(true);
      await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", workspacePath }),
      });
      setPreviewUrl(null);
    } catch (err) {
      console.error("Failed to stop serve:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // 6. 执行设计系统 Token 审查
  const handleRunAudit = async () => {
    if (!workspacePath) return;
    try {
      setIsLoading(true);
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "audit", workspacePath }),
      });
      const data = await res.json();
      setAuditReport(data.report || "审查完成，未发现硬编码违规。");
      setAuditPassed(Boolean(data.passed));
    } catch (err) {
      setAuditReport(`审查失败: ${String(err)}`);
      setAuditPassed(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside
      role="complementary"
      aria-label="设计工作坊"
      className={`flex flex-col bg-card border-l border-border h-full ${
        isExpanded ? "w-full" : "w-full max-w-full"
      }`}
    >
      {/* 顶部标题栏与全局操作 */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-raised select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-info-soft text-info-fg shrink-0">
            <Palette className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-foreground truncate">{canvasTitle}</span>
              {hasCanvas && (
                <span className="px-1.5 py-0.2 text-[10px] font-medium rounded-full bg-success-soft text-success-fg">
                  {boardCount} 个画板
                </span>
              )}
            </div>
            <span className="text-[11px] text-foreground-subtle truncate">Ginkgo Design Studio</span>
          </div>
        </div>

        {/* 顶部 Tab 切换器 */}
        <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border">
          <button
            onClick={() => setActiveTab("canvas")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              activeTab === "canvas"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>视觉画板</span>
          </button>
          <button
            onClick={() => setActiveTab("system")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              activeTab === "system"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>设计系统</span>
          </button>
          <button
            onClick={() => setActiveTab("files")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              activeTab === "files"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>源码与文件</span>
          </button>
        </div>

        {/* 右侧窗口控制 */}
        <div className="flex items-center gap-1">
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title={isExpanded ? "还原宽度" : "全屏沉浸"}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="关闭工作台"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* 主体工作区 */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {/* ===================== TAB 1: 视觉画板 (Canvas Preview) ===================== */}
        {activeTab === "canvas" && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* 画板工具条：响应式视口切换 & 独立服务控制 */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface-sunken/40 shrink-0 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-foreground-subtle mr-1">设备视口:</span>
                <button
                  onClick={() => setViewportWidth("100%")}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    viewportWidth === "100%"
                      ? "bg-card text-foreground shadow-xs border border-border"
                      : "text-foreground-subtle hover:text-foreground"
                  }`}
                  title="自适应桌面视口 (100%)"
                >
                  <Laptop className="w-3 h-3" />
                  <span>桌面 (100%)</span>
                </button>
                <button
                  onClick={() => setViewportWidth("768px")}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    viewportWidth === "768px"
                      ? "bg-card text-foreground shadow-xs border border-border"
                      : "text-foreground-subtle hover:text-foreground"
                  }`}
                  title="平板设备视口 (768px)"
                >
                  <Tablet className="w-3 h-3" />
                  <span>平板 (768)</span>
                </button>
                <button
                  onClick={() => setViewportWidth("390px")}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    viewportWidth === "390px"
                      ? "bg-card text-foreground shadow-xs border border-border"
                      : "text-foreground-subtle hover:text-foreground"
                  }`}
                  title="移动设备视口 (390px)"
                >
                  <Smartphone className="w-3 h-3" />
                  <span>手机 (390)</span>
                </button>
              </div>

              <div className="flex items-center gap-1">
                {previewUrl ? (
                  <>
                    <button
                      onClick={handleStartServe}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-foreground-subtle hover:text-foreground hover:bg-muted"
                      title="刷新画板服务"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span>刷新</span>
                    </button>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-info-fg hover:bg-info-soft"
                      title="在外部全屏浏览器标签页打开"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>新标签打开</span>
                    </a>
                    <button
                      onClick={handleStopServe}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-danger-fg hover:bg-danger-soft"
                      title="停止画板服务"
                    >
                      <Square className="w-3 h-3" />
                      <span>停止</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStartServe}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>启动预览服务</span>
                  </button>
                )}
              </div>
            </div>

            {/* 画板 iframe 容器 */}
            <div className="flex-1 bg-surface-sunken p-4 overflow-auto flex items-center justify-center">
              {previewUrl ? (
                <div
                  className="h-full bg-card rounded-xl shadow-lg border border-border overflow-hidden transition-all duration-300 flex flex-col"
                  style={{ width: viewportWidth, maxWidth: "100%" }}
                >
                  <iframe
                    title="Ginkgo Design Canvas Preview"
                    src={previewUrl}
                    className="w-full h-full border-0 bg-transparent flex-1"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center max-w-md p-8 rounded-2xl border border-dashed border-border bg-card">
                  <div className="w-12 h-12 rounded-xl bg-info-soft text-info-fg flex items-center justify-center mb-4">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-sm text-foreground mb-1">画板服务未启动</h3>
                  <p className="text-xs text-foreground-subtle leading-relaxed mb-4">
                    在左侧与 Agent 规划设计意图后，Agent 将自动调用{" "}
                    <code className="text-primary font-mono text-[11px] bg-muted px-1 rounded">design_canvas_serve</code>{" "}
                    实时呈现。你也可以在此直接启动。
                  </p>
                  <button
                    onClick={handleStartServe}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isLoading ? "正在启动..." : "启动画板实时预览"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB 2: 设计系统 (Design System) ===================== */}
        {activeTab === "system" && (
          <div className="flex-1 flex flex-col h-full overflow-y-auto p-4 space-y-6">
            {/* 设计规范审查 (Audit) */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-info-fg" />
                    <span>Design Token 合规性体检 (Audit)</span>
                  </h4>
                  <p className="text-[11px] text-foreground-subtle mt-0.5">
                    扫描工作区代码，确保无硬编码色值，严格遵循 Design Token 语义类。
                  </p>
                </div>
                <button
                  onClick={handleRunAudit}
                  disabled={isLoading}
                  className="px-3 py-1 text-xs font-medium rounded-lg bg-info-soft text-info-fg hover:bg-info/20 transition-colors"
                >
                  {isLoading ? "正在体检..." : "运行代码审查"}
                </button>
              </div>

              {auditReport && (
                <div
                  className={`rounded-lg p-3 text-xs border font-mono whitespace-pre-wrap leading-relaxed ${
                    auditPassed
                      ? "bg-success-soft/30 border-success-border text-success-fg"
                      : "bg-surface-sunken border-border text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5 font-semibold">
                    {auditPassed ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-success-fg" />
                        <span>规范检查通过</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-warning-fg" />
                        <span>存在未合规样式</span>
                      </>
                    )}
                  </div>
                  {auditReport}
                </div>
              )}
            </div>

            {/* 设计系统 Tokens 摘要 */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h4 className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                <Palette className="w-4 h-4 text-primary" />
                <span>全局 Design Tokens 概览</span>
              </h4>
              {hasDesignSystem && designSystemData ? (
                <div className="space-y-4">
                  <pre className="p-3 bg-surface-sunken rounded-lg text-xs font-mono text-foreground overflow-auto max-h-60 border border-border">
                    {JSON.stringify(designSystemData, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-6 text-foreground-subtle text-xs border border-dashed border-border rounded-lg">
                  当前工作区尚未建立 <code className="font-mono text-primary">project/design-system.json</code>。
                  在左侧让 Agent 为你生成或初始化规范即可在此处直观展现。
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB 3: 源码与文件 (Files & Spec) ===================== */}
        {activeTab === "files" && (
          <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧文件清单 */}
            <div className="w-56 border-r border-border bg-surface-sunken/40 flex flex-col shrink-0">
              <div className="px-3 py-2 border-b border-border text-[11px] font-semibold text-foreground-subtle uppercase tracking-wider">
                设计产物清单
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono truncate transition-colors flex items-center gap-1.5 ${
                      selectedFile === file.path
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground-subtle hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{file.path}</span>
                  </button>
                ))}
                {files.length === 0 && (
                  <div className="p-3 text-[11px] text-foreground-subtle text-center">暂无产物文件</div>
                )}
              </div>
            </div>

            {/* 右侧源码预览 */}
            <div className="flex-1 flex flex-col h-full bg-card overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-surface-raised flex items-center justify-between text-xs font-mono text-foreground-subtle">
                <span>{selectedFile || "未选择文件"}</span>
                <span className="text-[11px]">{fileContent.length} 字符</span>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-surface-sunken">
                <pre className="font-mono text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                  {fileContent || "文件内容为空"}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
