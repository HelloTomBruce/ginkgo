"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { BoardDetail, DashboardArtifact } from "../server/cliBridge";
import { isDesignArtifact, buildFileTree, type FileTreeNode } from "./designArtifacts";

/** 设计状态接口数据（网关 action=status 返回） */
interface DesignStatusData {
  hasCanvas?: boolean;
  canvasTitle?: string;
  boardCount?: number;
  boardsDetail?: BoardDetail[];
  dashboards?: DashboardArtifact[];
  previewUrl?: string;
  hasDesignSystem?: boolean;
  designSystem?: Record<string, unknown>;
}

/** 设计工坊文件清单项 */
export interface DesignFileItem {
  name: string;
  path: string;
  type?: string;
  size?: number;
  updatedAt?: number;
}

export interface UseDesignWorkspaceOptions {
  /** 当前会话 ID（网关归属权校验必需；缺省则不发起任何数据请求） */
  sessionId?: string;
  /** 当前应用 ID */
  appId?: string;
  /** 当前激活 Tab（files Tab 自动补查与 canvas Tab 探活轮询依赖） */
  activeTab: "canvas" | "data" | "system" | "files";
}

/**
 * 设计工坊工作台数据域 Hook：
 * 收拢状态、网关调用（单通道 /api/apps/design/action）、加载与探活轮询；
 * 渲染组件仅消费返回值，不含任何取数逻辑。
 *
 * 安全线约束：仅携带 sessionId/appId 标识符，工作区物理目录一律由
 * 服务端网关按会话归属解析，客户端不透传任何文件系统路径。
 */
export function useDesignWorkspace({ sessionId, appId, activeTab }: UseDesignWorkspaceOptions) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [canvasTitle, setCanvasTitle] = useState<string>("画板");
  const [boardCount, setBoardCount] = useState<number>(0);
  const [boardsDetail, setBoardsDetail] = useState<BoardDetail[]>([]);
  const [dashboards, setDashboards] = useState<DashboardArtifact[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [dashboardHtml, setDashboardHtml] = useState<string>("");
  const [hasCanvas, setHasCanvas] = useState<boolean>(false);
  const [hasDesignSystem, setHasDesignSystem] = useState<boolean>(false);
  const [designSystemData, setDesignSystemData] = useState<Record<string, unknown> | null>(null);
  const [auditReport, setAuditReport] = useState<string | null>(null);
  const [auditPassed, setAuditPassed] = useState<boolean | null>(null);
  const [files, setFiles] = useState<DesignFileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const pollTriesRef = useRef(0);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  // 当前激活的数据看板对象
  const activeDashboard = useMemo(() => {
    return dashboards.find((d) => d.id === selectedDashboardId) || dashboards[0] || null;
  }, [dashboards, selectedDashboardId]);

  // 通用网关调用（单通道：POST /api/apps/design/action）
  const sendAppAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      if (!sessionId) {
        throw new Error("缺少 sessionId，无法调用应用动作网关");
      }
      const res = await fetch("/api/apps/design/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, sessionId, appId }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`网关动作 [${action}] 失败 (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      return (await res.json()) as Record<string, unknown>;
    },
    [sessionId, appId]
  );

  // 1. 加载设计状态
  const loadDesignStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      setIsLoading(true);
      const data = (await sendAppAction("status")) as DesignStatusData;
      setHasCanvas(Boolean(data.hasCanvas));
      if (data.canvasTitle) setCanvasTitle(data.canvasTitle);
      setBoardCount(data.boardCount || 0);
      if (Array.isArray(data.boardsDetail)) {
        setBoardsDetail(data.boardsDetail);
      }
      if (Array.isArray(data.dashboards)) {
        setDashboards(data.dashboards);
        if (data.dashboards.length > 0 && !selectedDashboardId) {
          setSelectedDashboardId(data.dashboards[0].id);
        }
      }
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
      setHasDesignSystem(Boolean(data.hasDesignSystem));
      if (data.designSystem) setDesignSystemData(data.designSystem);
    } catch (err) {
      console.error("Failed to load design status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [sendAppAction, sessionId, selectedDashboardId]);

  // 2. 加载工作区文件树（设计产物清单）
  const loadFiles = useCallback(async () => {
    if (!sessionId) return;
    const query = new URLSearchParams({ appId: appId || "design", sessionId });
    try {
      const res = await fetch(`/api/workspace?${query.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.files)) {
        // 过滤目录项，且严格只保留设计工坊专属产物（project/ 下画板、数据看板、Tokens规范等）
        const designFiles = (data.files as DesignFileItem[]).filter(
          (f) => f.type !== "directory" && isDesignArtifact(f.path)
        );
        setFiles(designFiles);
        if (designFiles.length > 0) {
          setSelectedFile((prev) => {
            if (prev && designFiles.some((f) => f.path === prev)) return prev;
            return designFiles[0].path;
          });
        } else {
          setSelectedFile(null);
        }
      }
    } catch {
      // ignore
    }
  }, [appId, sessionId]);

  // 3. 读取单个文件内容
  const loadFileContent = useCallback(
    async (filePath: string): Promise<string> => {
      if (!sessionId) return "";
      const query = new URLSearchParams({ filePath, appId: appId || "design", sessionId });
      try {
        const res = await fetch(`/api/workspace?${query.toString()}`);
        if (res.ok) {
          const data = await res.json();
          return (data.content as string) || "";
        }
      } catch {
        // ignore
      }
      return "";
    },
    [appId, sessionId]
  );

  // 刷新全部（状态 + 产物清单）
  const refreshAll = useCallback(async () => {
    await Promise.allSettled([loadDesignStatus(), loadFiles()]);
  }, [loadDesignStatus, loadFiles]);

  // 初始化加载
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (!isCancelled) {
        await refreshAll();
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [refreshAll]);

  // 切到 files Tab 且列表为空时，自动补查刷新文件树
  useEffect(() => {
    let isCancelled = false;
    if (activeTab === "files" && sessionId && files.length === 0) {
      void (async () => {
        if (!isCancelled) {
          await loadFiles();
        }
      })();
    }
    return () => {
      isCancelled = true;
    };
  }, [activeTab, sessionId, files.length, loadFiles]);

  // 读取选中文件的内容（用于 Files Tab）
  useEffect(() => {
    let isCancelled = false;
    if (!selectedFile) return;
    void (async () => {
      const content = await loadFileContent(selectedFile);
      if (!isCancelled) {
        setFileContent(content);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [selectedFile, loadFileContent]);

  // 读取选中 Claude Data 看板的 HTML 内容
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (!activeDashboard?.relativePath) {
        if (!isCancelled) setDashboardHtml("");
        return;
      }
      const content = await loadFileContent(activeDashboard.relativePath);
      if (!isCancelled) {
        setDashboardHtml(content);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [activeDashboard, loadFileContent]);

  // 智能探活轮询：处于画板 Tab 且 previewUrl 为空时，定时探测服务是否由 Agent 或后台启动
  useEffect(() => {
    if (activeTab !== "canvas" || previewUrl) {
      pollTriesRef.current = 0;
      return;
    }
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (pollTriesRef.current >= 12) {
        clearInterval(interval);
        return;
      }
      pollTriesRef.current += 1;
      void loadDesignStatus();
    }, 2500);
    return () => clearInterval(interval);
  }, [activeTab, previewUrl, loadDesignStatus]);

  // 4. 启动预览服务
  const handleStartServe = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await sendAppAction("serve");
      if (typeof data.url === "string") {
        setPreviewUrl(data.url);
      }
    } catch (err) {
      console.error("Failed to start serve:", err);
    } finally {
      setIsLoading(false);
    }
  }, [sendAppAction]);

  // 5. 停止预览服务
  const handleStopServe = useCallback(async () => {
    try {
      setIsLoading(true);
      await sendAppAction("stop");
      setPreviewUrl(null);
    } catch (err) {
      console.error("Failed to stop serve:", err);
    } finally {
      setIsLoading(false);
    }
  }, [sendAppAction]);

  // 6. 执行设计系统 Token 审查
  const handleRunAudit = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await sendAppAction("audit");
      setAuditReport(
        typeof data.report === "string" ? data.report : "审查完成，未发现硬编码违规。"
      );
      setAuditPassed(Boolean(data.passed));
    } catch (err) {
      setAuditReport(`审查失败: ${String(err)}`);
      setAuditPassed(false);
    } finally {
      setIsLoading(false);
    }
  }, [sendAppAction]);

  return {
    // 数据
    previewUrl,
    canvasTitle,
    boardCount,
    boardsDetail,
    dashboards,
    selectedDashboardId,
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
    // 派生
    fileTree,
    activeDashboard,
    // 动作
    loadDesignStatus,
    loadFiles,
    refreshAll,
    setSelectedDashboardId,
    setSelectedFile,
    handleStartServe,
    handleStopServe,
    handleRunAudit,
  };
}

export type { FileTreeNode };
