"use client";

import React, { useState, useCallback } from "react";
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
  BarChart3,
  Eye,
  Code2,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";

import {
  getDesignFileIcon,
  type FileTreeNode,
  type DesignStudioTab,
} from "./designArtifacts";
import { useDesignWorkspace } from "./useDesignWorkspace";

export type { DesignStudioTab, FileTreeNode };
export { isDesignArtifact, buildFileTree } from "./designArtifacts";

export interface DesignStudioViewerProps {
  /** 当前会话 ID（网关归属校验与数据拉取唯一凭据） */
  sessionId?: string;
  /** 当前应用 ID */
  appId?: string;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  [key: string]: unknown;
}

interface FileTreeNodeItemProps {
  node: FileTreeNode;
  level?: number;
  selectedFile: string | null;
  collapsedDirs: Record<string, boolean>;
  onToggleDir: (dirPath: string) => void;
  onSelectFile: (filePath: string) => void;
}

function FileTreeNodeItem({
  node,
  level = 0,
  selectedFile,
  collapsedDirs,
  onToggleDir,
  onSelectFile,
}: FileTreeNodeItemProps) {
  const isDir = node.type === "directory";
  const isCollapsed = Boolean(collapsedDirs[node.path]);
  const isSelected = selectedFile === node.path;

  if (isDir) {
    return (
      <div className="select-none">
        <button
          type="button"
          onClick={() => onToggleDir(node.path)}
          style={{ paddingLeft: `${level * 12 + 6}px` }}
          className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded-md text-xs text-foreground-subtle hover:text-foreground hover:bg-muted/60 transition-colors text-left"
          title={node.path}
        >
          <ChevronRight
            className={`w-3 h-3 transition-transform text-foreground-faint shrink-0 ${
              isCollapsed ? "" : "rotate-90"
            }`}
          />
          {isCollapsed ? (
            <Folder className="w-3.5 h-3.5 text-warning-fg shrink-0" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5 text-warning-fg shrink-0" />
          )}
          <span className="truncate font-medium">{node.name}</span>
          {node.children.length > 0 && (
            <span className="text-[10px] text-foreground-faint shrink-0 ml-auto">
              {node.children.length}
            </span>
          )}
        </button>

        {!isCollapsed && (
          <div className="space-y-0.5">
            {node.children.map((child) => (
              <FileTreeNodeItem
                key={child.path}
                node={child}
                level={level + 1}
                selectedFile={selectedFile}
                collapsedDirs={collapsedDirs}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      style={{ paddingLeft: `${level * 12 + 18}px` }}
      className={`w-full flex items-center gap-1.5 py-1 px-1.5 rounded-md text-xs transition-colors text-left truncate font-mono ${
        isSelected
          ? "bg-primary text-primary-foreground font-medium shadow-xs"
          : "text-foreground-subtle hover:text-foreground hover:bg-muted/60"
      }`}
      title={node.path}
    >
      {getDesignFileIcon(node.path)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function DesignStudioViewer({
  sessionId,
  appId,
  onClose,
  isExpanded,
  onToggleExpand,
}: DesignStudioViewerProps) {
  // ===== UI 本地状态（纯视图，不涉取数） =====
  const [activeTab, setActiveTab] = useState<DesignStudioTab>("canvas");
  const [viewportWidth, setViewportWidth] = useState<string>("100%");
  const [selectedBoardKey, setSelectedBoardKey] = useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});

  const toggleDir = useCallback((dirPath: string) => {
    setCollapsedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  }, []);

  // ===== 数据域（状态 / 网关调用 / 加载 / 探活轮询全部收拢在 Hook 内） =====
  const {
    previewUrl,
    canvasTitle,
    boardCount,
    boardsDetail,
    dashboards,
    dashboardHtml,
    hasCanvas,
    hasDesignSystem,
    designSystemData,
    auditReport,
    auditPassed,
    files,
    selectedFile,
    fileContent,
    isLoading,
    fileTree,
    activeDashboard,
    loadDesignStatus,
    refreshAll,
    setSelectedDashboardId,
    setSelectedFile,
    handleStartServe,
    handleStopServe,
    handleRunAudit,
  } = useDesignWorkspace({ sessionId, appId, activeTab });

  // 选中的画板详情
  const currentBoard = selectedBoardKey
    ? boardsDetail.find((b) => b.key === selectedBoardKey) || null
    : null;

  return (
    <aside
      role="complementary"
      aria-label="设计工作坊"
      className={`flex flex-col bg-card border-l border-border h-full ${
        isExpanded ? "w-full" : "w-full max-w-full"
      }`}
    >
      {/* 顶部标题栏与全局操作 */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-raised select-none shrink-0 gap-2">
        {/* 左侧应用/画板信息 */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-info-soft text-info-fg shrink-0">
            <Palette className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-foreground truncate max-w-[110px] sm:max-w-[180px]">
                {canvasTitle}
              </span>
              {hasCanvas && (
                <span className="hidden xl:inline-flex px-1.5 py-0.2 text-[10px] font-medium rounded-full bg-success-soft text-success-fg shrink-0">
                  {boardCount} 个画板
                </span>
              )}
            </div>
            <span className="text-[10px] text-foreground-subtle truncate">Ginkgo Design Studio</span>
          </div>
        </div>

        {/* 顶部 L1 产物大类 Tab 切换器：精简 Icon 模式，隐藏冗长文案，消除挤压 */}
        <nav aria-label="产物类别切换" className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border shrink-0">
          <button
            onClick={() => setActiveTab("canvas")}
            title={`视觉画板${boardCount > 0 ? ` (${boardCount})` : ""}`}
            aria-label="视觉画板"
            className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === "canvas"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span className="sr-only">视觉画板</span>
            {boardCount > 0 && (
              <span className="px-1 rounded-full text-[10px] font-mono bg-surface-sunken text-foreground-subtle leading-tight">
                {boardCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("data")}
            title={`数据看板 (Claude Data)${dashboards.length > 0 ? ` (${dashboards.length})` : ""}`}
            aria-label="数据看板"
            className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === "data"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span className="sr-only">数据看板</span>
            {dashboards.length > 0 && (
              <span className="px-1 rounded-full text-[10px] font-mono bg-primary/10 text-brand-fg font-medium leading-tight">
                {dashboards.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("system")}
            title="设计系统 (Tokens 与体检)"
            aria-label="设计系统"
            className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === "system"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="sr-only">设计系统</span>
          </button>

          <button
            onClick={() => setActiveTab("files")}
            title={`源码与文件 (${files.length})`}
            aria-label="源码与文件"
            className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === "files"
                ? "bg-card text-foreground shadow-xs"
                : "text-foreground-subtle hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <FileCode className="w-4 h-4 shrink-0" />
            <span className="sr-only">源码与文件</span>
          </button>
        </nav>

        {/* 右侧窗口与刷新控制 */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              void refreshAll();
            }}
            disabled={isLoading}
            className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="刷新工作区产物状态"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
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
            {/* L2 二级控制条：画板切换胶囊 + 视口切换 */}
            <div className="flex flex-col border-b border-border bg-surface-sunken/40 shrink-0 text-xs">
              {/* 画板多实例选择条 */}
              {boardsDetail.length > 0 && (
                <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle overflow-x-auto select-none">
                  <span className="text-[11px] text-foreground-subtle mr-1 shrink-0">画板切换:</span>
                  <button
                    onClick={() => setSelectedBoardKey(null)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
                      selectedBoardKey === null
                        ? "bg-card text-foreground shadow-xs border border-border"
                        : "text-foreground-subtle hover:text-foreground hover:bg-muted/60"
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    <span>全景画布 ({boardCount})</span>
                  </button>
                  {boardsDetail.map((board) => {
                    const isSelected = selectedBoardKey === board.key;
                    return (
                      <button
                        key={board.key}
                        onClick={() => setSelectedBoardKey(board.key)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
                          isSelected
                            ? "bg-card text-brand-fg shadow-xs border border-brand-fg/30 font-semibold"
                            : "text-foreground-subtle hover:text-foreground hover:bg-muted/60"
                        }`}
                        title={`${board.key} (${board.width}×${board.height})`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>{board.title}</span>
                        <span className="text-[10px] text-foreground-faint font-mono">
                          {board.width}×{board.height}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 视口与服务操作条 */}
              <div className="flex items-center justify-between px-3 py-1.5">
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
                        onClick={loadDesignStatus}
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
            </div>

            {/* 画板 iframe 容器 */}
            <div className="flex-1 bg-surface-sunken p-4 overflow-auto flex items-center justify-center relative">
              {previewUrl ? (
                <div
                  className="h-full bg-card rounded-xl shadow-lg border border-border overflow-hidden transition-all duration-300 flex flex-col relative"
                  style={{ width: viewportWidth, maxWidth: "100%" }}
                >
                  {/* 单板聚焦提示浮条 */}
                  {currentBoard && (
                    <div className="px-3 py-1 bg-surface-raised border-b border-border flex items-center justify-between text-[11px] shrink-0">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <Eye className="w-3.5 h-3.5 text-brand-fg" />
                        <span>聚焦画板：{currentBoard.title} ({currentBoard.key})</span>
                        <span className="text-[10px] text-foreground-subtle">
                          设计规格: {currentBoard.width}×{currentBoard.height}px
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedFile(`project/${currentBoard.key}`);
                          setActiveTab("files");
                        }}
                        className="flex items-center gap-1 text-[10px] text-brand-fg hover:underline"
                      >
                        <Code2 className="w-3 h-3" />
                        <span>查看画板代码</span>
                      </button>
                    </div>
                  )}

                  {/* 预览服务运行在独立本地端口（与宿主不同源），allow-same-origin
                      仅保留其自身 origin 的脚本能力，用于画板编辑器内部交互 */}
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
                  <h3 className="font-semibold text-sm text-foreground mb-1">
                    {hasCanvas ? "画板结构已就绪，预览服务探活中" : "画板服务未启动"}
                  </h3>
                  <p className="text-xs text-foreground-subtle leading-relaxed mb-4">
                    {hasCanvas
                      ? `已检测到 ${boardCount} 个画板文件。正在后台智能探活预览服务（默认受控标准端口），你也可以点击下方按钮立即唤醒。`
                      : "在左侧与 Agent 规划设计意图后，方案确认进入构建阶段将自动初始化画板并启动实时预览。"}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleStartServe}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{isLoading ? "正在启动..." : "立即启动画板服务"}</span>
                    </button>
                    <button
                      onClick={loadDesignStatus}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                      <span>探活刷新</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB 2: 数据看板 (Claude Data Dashboards) ===================== */}
        {activeTab === "data" && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* L2 二级控制条：多个数据看板切换胶囊 */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface-sunken/40 shrink-0 text-xs">
              <div className="flex items-center gap-1 overflow-x-auto select-none">
                <span className="text-[11px] text-foreground-subtle mr-1 shrink-0">看板切换:</span>
                {dashboards.length > 0 ? (
                  dashboards.map((dash) => {
                    const isSelected = activeDashboard?.id === dash.id;
                    return (
                      <button
                        key={dash.id}
                        onClick={() => setSelectedDashboardId(dash.id)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
                          isSelected
                            ? "bg-card text-brand-fg shadow-xs border border-brand-fg/30 font-semibold"
                            : "text-foreground-subtle hover:text-foreground hover:bg-muted/60"
                        }`}
                        title={dash.relativePath}
                      >
                        <BarChart3 className="w-3 h-3" />
                        <span>{dash.title}</span>
                      </button>
                    );
                  })
                ) : (
                  <span className="text-[11px] text-foreground-faint">暂无检测到数据看板</span>
                )}
              </div>

              {activeDashboard && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-foreground-subtle font-mono truncate max-w-[180px]">
                    {activeDashboard.relativePath}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedFile(activeDashboard.relativePath);
                      setActiveTab("files");
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-foreground-subtle hover:text-foreground hover:bg-muted"
                    title="查看看板 HTML 源码"
                  >
                    <Code2 className="w-3 h-3" />
                    <span>查看源码</span>
                  </button>
                </div>
              )}
            </div>

            {/* 看板实时内嵌沙箱渲染器 */}
            <div className="flex-1 bg-surface-sunken p-4 overflow-hidden flex items-center justify-center">
              {activeDashboard && dashboardHtml ? (
                <div className="w-full h-full bg-card rounded-xl shadow-lg border border-border overflow-hidden flex flex-col">
                  {/* 安全线：srcdoc iframe 会继承宿主 origin，严禁携带 allow-same-origin——
                      否则模型生成的看板脚本可同源访问宿主 DOM 与 localStorage 凭据。
                      去掉该标志后脚本运行在 opaque origin，静态看板渲染不受影响。 */}
                  <iframe
                    title={`Claude Data - ${activeDashboard.title}`}
                    srcDoc={dashboardHtml}
                    className="w-full h-full border-0 bg-transparent flex-1"
                    sandbox="allow-scripts allow-forms allow-popups"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center max-w-md p-8 rounded-2xl border border-dashed border-border bg-card">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 text-brand-fg flex items-center justify-center mb-4">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-sm text-foreground mb-1">
                    {dashboards.length > 0 ? "正在加载看板数据..." : "暂无 Claude Data 看板产物"}
                  </h3>
                  <p className="text-xs text-foreground-subtle leading-relaxed mb-4">
                    {dashboards.length > 0
                      ? "正在从沙箱读取看板页面并注入工作台渲染引擎..."
                      : "在左侧让 Agent 产出业务数据看板（如 `*.dashboard.html` / 图表可视化），工作台将自动感知并提供可交互的多看板切换呈现。"}
                  </p>
                  <button
                    onClick={() => {
                      void refreshAll();
                    }}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                    <span>重新扫描产物</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB 3: 设计系统 (Design System) ===================== */}
        {activeTab === "system" && (
          <div className="flex-1 flex flex-col h-full overflow-y-auto p-4 space-y-6">
            {/* 设计规范审查 */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-info-fg" />
                    <span>Design Token 合规性体检</span>
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
                  {isLoading ? "审查中..." : "重新运行 Audit 审查"}
                </button>
              </div>

              {auditReport ? (
                <div
                  className={`p-3 rounded-lg border text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto ${
                    auditPassed
                      ? "bg-success-soft/30 border-success-soft text-success-fg"
                      : "bg-surface-sunken border-border text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-2 font-semibold">
                    {auditPassed ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-success-fg" />
                        <span>审计通过：无硬编码样式违规</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-warning-fg" />
                        <span>发现样式违规或存在硬编码项：</span>
                      </>
                    )}
                  </div>
                  {auditReport}
                </div>
              ) : (
                <div className="p-4 text-center rounded-lg border border-dashed border-border bg-surface-sunken/40">
                  <p className="text-xs text-foreground-subtle">
                    点击右上角「重新运行 Audit 审查」按钮，将深度扫描工作区是否存在硬编码色值。
                  </p>
                </div>
              )}
            </div>

            {/* Design Tokens 可视化展示 */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-primary" />
                  <span>全局 Design Tokens 概览</span>
                </h4>
                {hasDesignSystem && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-info-soft text-info-fg font-medium">
                    已加载 design-system.json
                  </span>
                )}
              </div>

              {hasDesignSystem && designSystemData ? (
                <div className="space-y-4">
                  <div className="bg-surface-sunken p-3 rounded-lg border border-border">
                    <span className="text-xs font-medium text-foreground block mb-2">Token 数据概览</span>
                    <pre className="text-[11px] font-mono text-foreground-subtle max-h-72 overflow-y-auto">
                      {JSON.stringify(designSystemData, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center rounded-lg border border-dashed border-border bg-surface-sunken/40">
                  <Palette className="w-8 h-8 text-foreground-subtle mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-foreground font-medium mb-1">未检测到 design-system.json</p>
                  <p className="text-[11px] text-foreground-subtle">
                    在左侧与 Agent 沟通创建全局 Tokens，Agent 将在此生成结构化样式规范。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB 4: 源码与文件树 ===================== */}
        {activeTab === "files" && (
          <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧层级文件树 */}
            <div className="w-60 border-r border-border bg-surface-sunken/40 flex flex-col shrink-0 select-none">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between text-xs font-semibold text-foreground">
                <span className="flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-warning-fg" />
                  <span>设计产物清单</span>
                </span>
                <span className="text-[10px] text-foreground-subtle font-mono">{files.length} 个文件</span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {fileTree.length > 0 ? (
                  fileTree.map((node) => (
                    <FileTreeNodeItem
                      key={node.path}
                      node={node}
                      selectedFile={selectedFile}
                      collapsedDirs={collapsedDirs}
                      onToggleDir={toggleDir}
                      onSelectFile={setSelectedFile}
                    />
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-foreground-subtle">暂无设计文件</div>
                )}
              </div>
            </div>

            {/* 右侧文件代码预览 */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-card">
              <div className="px-4 py-2 border-b border-border bg-surface-raised flex items-center justify-between text-xs font-mono text-foreground shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="w-3.5 h-3.5 text-brand-fg shrink-0" />
                  <span className="truncate">{selectedFile || "未选择文件"}</span>
                </div>
                {selectedFile && (
                  <span className="text-[10px] text-foreground-subtle uppercase shrink-0">
                    {selectedFile.split(".").pop()}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto p-4 bg-surface-sunken">
                {selectedFile ? (
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed select-text">
                    {fileContent || "加载中..."}
                  </pre>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-foreground-subtle">
                    选择左侧文件树节点查看代码
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
