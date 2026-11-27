"use client";

/**
 * 多维工作台壳：Tab 装配 + 文件树 / Git 变更 / 终端三个切片。
 * 浏览器自动化切片自持于 ./browser/BrowserView，经 onOperationsCountChange 上报徽标计数。
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  FileCode2,
  Folder,
  FolderOpen,
  FileText,
  File,
  X,
  Maximize2,
  Minimize2,
  RefreshCw,
  Code2,
  Terminal,
  GitBranch,
  FolderGit2,
  ChevronRight,
  ChevronsUpDown,
  Send,
  RotateCcw,
  Globe,
} from "lucide-react";
import type { AppWorkspaceProps } from "@ginkgolab/app-sdk";
import { DiffViewer, TerminalViewer } from "@ginkgolab/components";
import { CopyButton } from "@ginkgolab/components/ui/copy-button";
import { MarkdownPreview } from "./MarkdownPreview";
import { BrowserView } from "./browser/BrowserView";
import { buildFileTree, type FileTreeNode, type WorkspaceFileItem } from "./fileTree";

export type WorkspaceTab = "files" | "git" | "terminal" | "browser";

export interface GitChangeItem {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked";
  diff?: string;
}

export interface TerminalHistoryItem {
  id: string;
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  timestamp: number;
}

export function ArtifactViewer({
  onClose,
  sessionId,
  appId = "general",
  isExpanded,
  onToggleExpand,
  messages: propMessages,
  isStreaming,
}: AppWorkspaceProps) {
  // 当前活跃 Tab：文件树 / Git变更 / 终端 / 浏览器
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("files");

  // ===== 1. 文件树相关状态 =====
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [contentLoading, setContentLoading] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [mdPreviewMode, setMdPreviewMode] = useState<"code" | "preview">("preview");

  // ===== 2. Git 变更相关状态 =====
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [gitBranch, setGitBranch] = useState("main");
  const [gitChanges, setGitChanges] = useState<GitChangeItem[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [selectedGitPath, setSelectedGitPath] = useState<string | null>(null);

  // ===== 3. 终端相关状态 =====
  const [terminalHistory, setTerminalHistory] = useState<TerminalHistoryItem[]>([]);
  const [commandInput, setCommandInput] = useState("");
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  // ===== 4. 浏览器 Tab 徽标计数（流水明细由 BrowserView 自持） =====
  const [browserOpsCount, setBrowserOpsCount] = useState(0);
  const handleOpsCountChange = useCallback((count: number) => setBrowserOpsCount(count), []);

  const sid = typeof sessionId === "string" ? sessionId : "default";

  // 加载工作区文件列表
  const fetchFiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/workspace?appId=${encodeURIComponent(String(appId))}&sessionId=${encodeURIComponent(sid)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.files)) {
        setFiles(data.files);
        setSelectedFilePath((prev) => {
          if (prev) return prev;
          const firstFile = data.files.find((f: WorkspaceFileItem) => f.type === "file");
          return firstFile ? firstFile.path : null;
        });
      }
    } catch (err) {
      console.error("[ArtifactViewer] 加载工作区文件失败:", err);
    } finally {
      setLoading(false);
    }
  }, [sid, appId]);

  // 加载 Git 变更状态
  const fetchGitStatus = useCallback(async () => {
    try {
      setGitLoading(true);
      const res = await fetch(
        `/api/workspace?appId=${encodeURIComponent(
          String(appId)
        )}&sessionId=${encodeURIComponent(sid)}&action=git_status`
      );
      if (!res.ok) return;
      const data = await res.json();
      setIsGitRepo(Boolean(data.isGitRepo));
      if (data.branch) setGitBranch(data.branch);
      if (Array.isArray(data.changes)) {
        setGitChanges(data.changes);
        setSelectedGitPath((prev) => {
          if (prev && data.changes.some((c: GitChangeItem) => c.path === prev)) return prev;
          return data.changes[0]?.path ?? null;
        });
      }
    } catch (err) {
      console.error("[ArtifactViewer] 加载 Git 状态失败:", err);
    } finally {
      setGitLoading(false);
    }
  }, [sid, appId]);

  // 读取选中文件的内容
  useEffect(() => {
    let isCancelled = false;
    if (!selectedFilePath || activeTab !== "files") return;

    void (async () => {
      try {
        setContentLoading(true);
        const res = await fetch(
          `/api/workspace?appId=${encodeURIComponent(
            String(appId)
          )}&sessionId=${encodeURIComponent(sid)}&filePath=${encodeURIComponent(selectedFilePath)}`
        );
        const data = res.ok ? await res.json() : null;
        if (!isCancelled && data && typeof data.content === "string") {
          setFileContent(data.content);
        }
      } catch (err) {
        if (!isCancelled) console.error("[ArtifactViewer] 读取文件内容失败:", err);
      } finally {
        if (!isCancelled) setContentLoading(false);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [selectedFilePath, sid, appId, activeTab]);

  // 初始化加载
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (!isCancelled) {
        await fetchFiles();
        await fetchGitStatus();
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [fetchFiles, fetchGitStatus]);

  // 切换选项卡
  const handleSelectTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
  };

  // 流式完成瞬间（isStreaming true -> false）自动对账刷新工作区文件
  const prevStreamingRef = useRef(Boolean(isStreaming));
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      void fetchFiles();
      void fetchGitStatus();
    }
    prevStreamingRef.current = Boolean(isStreaming);
  }, [isStreaming, fetchFiles, fetchGitStatus]);

  // 终端命令执行
  const handleRunCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun || commandInput).trim();
    if (!cmd || isExecutingCmd) return;

    setIsExecutingCmd(true);
    setCommandInput("");

    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: String(appId),
          sessionId: sid,
          command: cmd,
        }),
      });

      const data = await res.json();
      const item: TerminalHistoryItem = {
        id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        command: cmd,
        stdout: data.stdout,
        stderr: data.stderr || data.error,
        exitCode: data.exitCode ?? (data.success ? 0 : 1),
        durationMs: data.durationMs,
        timestamp: Date.now(),
      };

      setTerminalHistory((prev) => [...prev, item]);
      // 命令可能引起文件或 git 状态变更，异步联动刷新
      void fetchFiles();
      void fetchGitStatus();
    } catch (err) {
      const item: TerminalHistoryItem = {
        id: `term-${Date.now()}`,
        command: cmd,
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        timestamp: Date.now(),
      };
      setTerminalHistory((prev) => [...prev, item]);
    } finally {
      setIsExecutingCmd(false);
      setTimeout(() => {
        terminalBottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
      }, 50);
    }
  };

  const getFileIcon = (itemPath: string) => {
    if (
      itemPath.endsWith(".ts") ||
      itemPath.endsWith(".tsx") ||
      itemPath.endsWith(".js") ||
      itemPath.endsWith(".jsx")
    ) {
      return <FileCode2 className="w-3.5 h-3.5 text-brand-fg shrink-0" />;
    }
    if (itemPath.endsWith(".md") || itemPath.endsWith(".txt")) {
      return <FileText className="w-3.5 h-3.5 text-info-fg shrink-0" />;
    }
    if (itemPath.endsWith(".json") || itemPath.endsWith(".yaml") || itemPath.endsWith(".yml")) {
      return <Code2 className="w-3.5 h-3.5 text-warning-fg shrink-0" />;
    }
    return <File className="w-3.5 h-3.5 text-foreground-subtle shrink-0" />;
  };

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const totalFilesCount = useMemo(() => files.filter((f) => f.type === "file").length, [files]);

  const handleToggleAllDirs = () => {
    const hasAnyCollapsed = Object.values(collapsedDirs).some(Boolean);
    if (hasAnyCollapsed) {
      setCollapsedDirs({});
    } else {
      const allDirs: Record<string, boolean> = {};
      for (const item of files) {
        if (item.type === "directory") {
          allDirs[item.path] = true;
        }
      }
      setCollapsedDirs(allDirs);
    }
  };

  const selectedGitChange = useMemo(
    () => gitChanges.find((c) => c.path === selectedGitPath),
    [gitChanges, selectedGitPath]
  );

  // 递归渲染文件树节点
  const renderTreeNode = (node: FileTreeNode, level = 0): React.ReactNode => {
    const isDir = node.type === "directory";
    const isCollapsed = Boolean(collapsedDirs[node.path]);
    const isSelected = selectedFilePath === node.path;

    if (isDir) {
      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() =>
              setCollapsedDirs((prev) => ({
                ...prev,
                [node.path]: !prev[node.path],
              }))
            }
            style={{ paddingLeft: `${level * 12 + 6}px` }}
            className="flex items-center gap-1.5 py-1 px-1.5 rounded text-xs text-foreground-subtle hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
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
              <span className="text-[10px] text-foreground-faint shrink-0">
                ({node.children.length})
              </span>
            )}
          </div>

          {!isCollapsed && (
            <div className="space-y-0.5">
              {node.children.map((child) => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        onClick={() => setSelectedFilePath(node.path)}
        style={{ paddingLeft: `${level * 12 + 18}px` }}
        className={`flex items-center gap-1.5 py-1 px-1.5 rounded text-xs cursor-pointer transition-colors truncate ${
          isSelected
            ? "bg-brand-soft text-brand-fg font-medium"
            : "text-foreground-subtle hover:text-foreground hover:bg-muted"
        }`}
        title={node.path}
      >
        {getFileIcon(node.path)}
        <span className="truncate">{node.name}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border select-none min-w-0">
      {/* 顶部工具栏与 Tab 切换器 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40 gap-3">
        {/* 左侧：多维工作台 Tab 切换 */}
        <div className="flex items-center gap-1 bg-surface-sunken p-1 rounded-lg border border-border">
          <button
            type="button"
            onClick={() => handleSelectTab("files")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "files"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <Folder className="w-3.5 h-3.5 text-warning-fg" />
            <span>文件</span>
            {totalFilesCount > 0 && (
              <span className="text-[10px] bg-muted px-1 rounded-full text-foreground-subtle">
                {totalFilesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab("git")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "git"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-info-fg" />
            <span>Git 变更</span>
            {gitChanges.length > 0 && (
              <span className="text-[10px] bg-brand-soft text-brand-fg px-1.5 py-0.2 rounded-full font-bold">
                {gitChanges.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab("terminal")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "terminal"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-brand-fg" />
            <span>终端</span>
            {terminalHistory.length > 0 && (
              <span className="text-[10px] bg-muted px-1 rounded-full text-foreground-subtle">
                {terminalHistory.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab("browser")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "browser"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-foreground-subtle hover:text-foreground"
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-brand-fg" />
            <span>浏览器</span>
            {browserOpsCount > 0 && (
              <span className="text-[10px] bg-brand-soft text-brand-fg px-1.5 py-0.2 rounded-full font-bold">
                {browserOpsCount}
              </span>
            )}
          </button>
        </div>

        {/* 右侧：操作区与窗口控制 */}
        <div className="flex items-center gap-1 shrink-0">
          {activeTab === "files" && selectedFilePath && (
            <CopyButton text={fileContent} label="复制文件内容" variant="icon" />
          )}

          {activeTab === "files" && (
            <button
              type="button"
              onClick={fetchFiles}
              disabled={loading}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="刷新文件列表"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}

          {activeTab === "git" && (
            <button
              type="button"
              onClick={fetchGitStatus}
              disabled={gitLoading}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="刷新 Git 变更状态"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${gitLoading ? "animate-spin" : ""}`} />
            </button>
          )}

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title={isExpanded ? "还原工作台" : "全屏最大化"}
            >
              {isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="关闭工作区"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 主体内容区：依据 activeTab 分发渲染 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ==================== 1. 文件树视图 ==================== */}
        {activeTab === "files" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* 左侧文件树 */}
            <div className="w-60 border-r border-border flex flex-col bg-muted/20 shrink-0">
              <div className="px-3 py-2 text-[11px] font-medium text-foreground-subtle uppercase tracking-wider border-b border-border flex items-center justify-between">
                <span>文件目录</span>
                {fileTree.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleAllDirs}
                    className="p-1 hover:bg-muted rounded text-foreground-faint hover:text-foreground transition-colors"
                    title="切换全部折叠/展开"
                  >
                    <ChevronsUpDown className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {files.length === 0 ? (
                  <div className="text-center py-8 text-xs text-foreground-subtle px-2">
                    暂无生成文件
                  </div>
                ) : (
                  fileTree.map((node) => renderTreeNode(node))
                )}
              </div>
            </div>

            {/* 右侧文件代码/Markdown 预览 */}
            <div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden">
              {selectedFilePath ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center justify-between text-xs text-foreground-subtle">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-foreground font-medium">
                        {selectedFilePath}
                      </span>
                      <span>{fileContent.split("\n").length} 行</span>
                    </div>

                    {selectedFilePath.endsWith(".md") && (
                      <div className="flex items-center gap-1 rounded bg-muted p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setMdPreviewMode("preview")}
                          className={`px-2 py-0.5 rounded transition-colors ${
                            mdPreviewMode === "preview"
                              ? "bg-card text-foreground font-medium shadow-xs"
                              : "text-foreground-subtle hover:text-foreground"
                          }`}
                        >
                          排版预览
                        </button>
                        <button
                          type="button"
                          onClick={() => setMdPreviewMode("code")}
                          className={`px-2 py-0.5 rounded transition-colors ${
                            mdPreviewMode === "code"
                              ? "bg-card text-foreground font-medium shadow-xs"
                              : "text-foreground-subtle hover:text-foreground"
                          }`}
                        >
                          源码
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-auto text-xs text-foreground leading-relaxed">
                    {contentLoading ? (
                      <div className="flex items-center justify-center h-full text-foreground-subtle">
                        加载文件中...
                      </div>
                    ) : selectedFilePath.endsWith(".md") && mdPreviewMode === "preview" ? (
                      <MarkdownPreview content={fileContent} />
                    ) : (
                      <div className="flex font-mono text-xs min-h-full">
                        <div className="py-4 pr-3 pl-4 text-right text-foreground-subtle/40 select-none bg-surface-sunken/40 border-r border-border/40 font-mono">
                          {fileContent.split("\n").map((_, i) => (
                            <div key={i} className="leading-5">
                              {i + 1}
                            </div>
                          ))}
                        </div>
                        <pre className="p-4 flex-1 whitespace-pre overflow-x-auto selection:bg-brand-soft leading-5">
                          <code>{fileContent}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-foreground-subtle">
                  <Folder className="w-12 h-12 stroke-[1.2] mb-3 text-foreground-faint" />
                  <p className="text-sm font-medium text-foreground mb-1">沙箱工作区就绪</p>
                  <p className="text-xs max-w-sm text-foreground-subtle">
                    让通用助手编写代码或生成文档，生成的文件将自动在此展示并支持审阅与复制。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== 2. Git 变更视图 ==================== */}
        {activeTab === "git" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* 左侧：变更文件列表 */}
            <div className="w-64 border-r border-border flex flex-col bg-muted/20 shrink-0">
              <div className="px-3 py-2 text-[11px] font-medium text-foreground-subtle uppercase tracking-wider border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5 truncate">
                  <FolderGit2 className="w-3.5 h-3.5 text-info-fg shrink-0" />
                  <span className="truncate">分支: {gitBranch}</span>
                </div>
                <span className="text-[10px] text-foreground-faint">
                  {gitChanges.length} 处改动
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {!isGitRepo ? (
                  <div className="text-center py-8 text-xs text-foreground-subtle px-3 space-y-2">
                    <p>当前工作区暂未初始化 Git</p>
                    <button
                      type="button"
                      onClick={() => handleRunCommand("git init")}
                      className="px-2.5 py-1 rounded bg-brand-solid text-brand-solid-fg text-xs font-medium hover:opacity-90"
                    >
                      执行 git init
                    </button>
                  </div>
                ) : gitChanges.length === 0 ? (
                  <div className="text-center py-8 text-xs text-foreground-subtle px-3">
                    <p className="text-success-fg font-medium mb-1">✓ 工作区很干净</p>
                    <p className="text-[11px] text-foreground-faint">暂无未提交的代码变更</p>
                  </div>
                ) : (
                  gitChanges.map((change) => {
                    const isSelected = selectedGitPath === change.path;
                    const statusConfig = {
                      modified: { label: "M", bg: "bg-warning-soft text-warning-fg" },
                      added: { label: "A", bg: "bg-success-soft text-success-fg" },
                      deleted: { label: "D", bg: "bg-danger-soft text-danger-fg" },
                      untracked: { label: "?", bg: "bg-muted text-foreground-subtle" },
                    }[change.status];

                    return (
                      <div
                        key={change.path}
                        onClick={() => setSelectedGitPath(change.path)}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-brand-soft text-brand-fg font-medium"
                            : "hover:bg-muted text-foreground-subtle hover:text-foreground"
                        }`}
                      >
                        <span className="font-mono truncate">{change.path}</span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 ${statusConfig.bg}`}
                        >
                          {statusConfig.label}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 右侧：Diff 对比展示 */}
            <div className="flex-1 flex flex-col min-w-0 bg-card overflow-auto p-4">
              {selectedGitChange ? (
                <DiffViewer
                  diffText={selectedGitChange.diff}
                  title={`变更对比: ${selectedGitChange.path}`}
                  defaultOpen={true}
                  defaultMode="unified"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-foreground-subtle">
                  <FolderGit2 className="w-12 h-12 stroke-[1.2] mb-3 text-foreground-faint" />
                  <p className="text-sm font-medium text-foreground mb-1">选择左侧文件查看 Diff</p>
                  <p className="text-xs max-w-sm text-foreground-subtle">
                    实时查看大模型修改代码产生的变更与差异，支持单栏内联与双栏并排对比。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== 3. 终端与命令执行视图 ==================== */}
        {activeTab === "terminal" && (
          <div className="flex-1 flex flex-col min-w-0 bg-surface-sunken overflow-hidden font-mono text-xs">
            {/* 终端历史输出区域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {terminalHistory.length === 0 ? (
                <div className="text-center py-12 text-foreground-subtle font-sans space-y-2">
                  <Terminal className="w-10 h-10 mx-auto text-foreground-faint stroke-[1.2]" />
                  <p className="text-xs">沙箱命令行终端已就绪</p>
                  <p className="text-[11px] text-foreground-faint max-w-md mx-auto">
                    助手执行的命令记录与你手动触发的终端命令将呈现在此。
                  </p>
                </div>
              ) : (
                terminalHistory.map((item) => (
                  <TerminalViewer
                    key={item.id}
                    command={item.command}
                    output={item.stdout || item.stderr}
                    exitCode={item.exitCode}
                    durationMs={item.durationMs}
                    defaultOpen={true}
                  />
                ))
              )}
              <div ref={terminalBottomRef} />
            </div>

            {/* 快速常用命令标签 */}
            <div className="px-4 py-1.5 border-t border-border/40 bg-card/40 flex items-center gap-1.5 text-[11px] overflow-x-auto shrink-0 select-none">
              <span className="text-foreground-faint font-sans">快捷指令:</span>
              {["git status", "ls -la", "pwd", "git diff", "git log -n 3 --oneline"].map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => void handleRunCommand(cmd)}
                  disabled={isExecutingCmd}
                  className="px-2 py-0.5 rounded bg-surface-sunken border border-border text-foreground-subtle hover:text-foreground hover:bg-card transition-colors shrink-0"
                >
                  {cmd}
                </button>
              ))}
              {terminalHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTerminalHistory([])}
                  className="ml-auto text-foreground-faint hover:text-foreground flex items-center gap-1 text-[10px]"
                >
                  <RotateCcw className="w-3 h-3" /> 清屏
                </button>
              )}
            </div>

            {/* 底部交互式命令行输入条 */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRunCommand();
              }}
              className="p-3 border-t border-border bg-card flex items-center gap-2 shrink-0"
            >
              <div className="flex items-center gap-1.5 flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-1.5 focus-within:ring-1 focus-within:ring-brand-border">
                <span className="text-brand-fg font-bold select-none">$</span>
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="在工作区沙箱执行 Shell 命令 (如 pnpm test, git status)..."
                  disabled={isExecutingCmd}
                  className="w-full bg-transparent text-xs text-foreground focus:outline-none font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={!commandInput.trim() || isExecutingCmd}
                className="px-3.5 py-1.5 rounded-lg bg-brand-solid text-brand-solid-fg text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-1.5 shrink-0"
              >
                {isExecutingCmd ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>执行</span>
              </button>
            </form>
          </div>
        )}

        {/* ==================== 4. 浏览器自动化操作与状态视图（自持切片） ==================== */}
        {activeTab === "browser" && (
          <BrowserView
            appId={String(appId)}
            sessionId={sid}
            messages={propMessages}
            isStreaming={Boolean(isStreaming)}
            onOperationsCountChange={handleOpsCountChange}
          />
        )}
      </div>
    </div>
  );
}
