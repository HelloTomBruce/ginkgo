"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileCode2,
  Folder,
  FileText,
  File,
  X,
  Maximize2,
  Minimize2,
  RefreshCw,
  Copy,
  Check,
  Code2,
  Terminal,
} from "lucide-react";
import type { AppWorkspaceProps } from "@openui-analytics/app-sdk";

export interface WorkspaceFileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt: number;
}

export function ArtifactViewer({
  onClose,
  sessionId,
  appId = "general",
  isExpanded,
  onToggleExpand,
}: AppWorkspaceProps) {
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [contentLoading, setContentLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // 加载工作区文件列表
  const fetchFiles = useCallback(async () => {
    const sid = typeof sessionId === "string" ? sessionId : "default";
    try {
      setLoading(true);
      const res = await fetch(
        `/api/workspace?appId=${encodeURIComponent(String(appId))}&sessionId=${encodeURIComponent(sid)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.files)) {
        setFiles(data.files);
        // 若没有选中文件，默认选中第一个文件
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
  }, [sessionId, appId]);

  useEffect(() => {
    let isCancelled = false;
    if (!selectedFilePath) return;

    const sid = typeof sessionId === "string" ? sessionId : "default";
    const target = selectedFilePath;

    void (async () => {
      try {
        setContentLoading(true);
        const res = await fetch(
          `/api/workspace?appId=${encodeURIComponent(String(appId))}&sessionId=${encodeURIComponent(
            sid
          )}&filePath=${encodeURIComponent(target)}`
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
  }, [selectedFilePath, sessionId, appId]);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (!isCancelled) {
        await fetchFiles();
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [fetchFiles]);

  const handleCopy = () => {
    if (!fileContent) return;
    navigator.clipboard.writeText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getFileIcon = (itemPath: string) => {
    if (itemPath.endsWith(".ts") || itemPath.endsWith(".tsx") || itemPath.endsWith(".js") || itemPath.endsWith(".jsx")) {
      return <FileCode2 className="w-4 h-4 text-brand-fg shrink-0" />;
    }
    if (itemPath.endsWith(".md") || itemPath.endsWith(".txt")) {
      return <FileText className="w-4 h-4 text-info-fg shrink-0" />;
    }
    if (itemPath.endsWith(".json") || itemPath.endsWith(".yaml") || itemPath.endsWith(".yml")) {
      return <Code2 className="w-4 h-4 text-warning-fg shrink-0" />;
    }
    return <File className="w-4 h-4 text-foreground-subtle shrink-0" />;
  };

  const onlyFiles = files.filter((f) => f.type === "file");

  return (
    <div className="flex flex-col h-full bg-card border-l border-border select-none min-w-0">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-brand-fg shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            工作区产物 ({onlyFiles.length})
          </span>
          {selectedFilePath && (
            <span className="text-xs text-foreground-subtle font-mono truncate max-w-[200px]">
              / {selectedFilePath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={fetchFiles}
            disabled={loading}
            className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="刷新文件列表"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {selectedFilePath && (
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="复制文件内容"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success-fg" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1.5 text-foreground-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title={isExpanded ? "还原工作台" : "全屏最大化"}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
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

      {/* 主体分栏 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧文件列表栏 */}
        <div className="w-52 border-r border-border flex flex-col bg-muted/20 shrink-0">
          <div className="px-3 py-2 text-[11px] font-medium text-foreground-subtle uppercase tracking-wider border-b border-border">
            文件清单
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {onlyFiles.length === 0 ? (
              <div className="text-center py-8 text-xs text-foreground-subtle px-2">
                暂无生成文件
              </div>
            ) : (
              onlyFiles.map((file) => {
                const isSelected = file.path === selectedFilePath;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedFilePath(file.path)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left transition-colors truncate ${
                      isSelected
                        ? "bg-brand-soft text-brand-fg font-medium"
                        : "text-foreground-subtle hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {getFileIcon(file.path)}
                    <span className="truncate">{file.path}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧文件代码预览区 */}
        <div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden">
          {selectedFilePath ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center justify-between text-xs text-foreground-subtle">
                <span className="font-mono">{selectedFilePath}</span>
                <span>{fileContent.split("\n").length} 行</span>
              </div>
              <div className="flex-1 p-4 overflow-auto font-mono text-xs text-foreground leading-relaxed">
                {contentLoading ? (
                  <div className="flex items-center justify-center h-full text-foreground-subtle">
                    加载文件中...
                  </div>
                ) : (
                  <pre className="whitespace-pre overflow-x-auto selection:bg-brand-soft">
                    <code>{fileContent}</code>
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-foreground-subtle">
              <Folder className="w-12 h-12 stroke-[1.2] mb-3 text-foreground-faint" />
              <p className="text-sm font-medium text-foreground mb-1">沙箱工作区已就绪</p>
              <p className="text-xs max-w-sm text-foreground-subtle">
                让通用助手编写代码、生成文档或执行命令，工作区生成的文件将自动在此展示并支持一键复制。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
