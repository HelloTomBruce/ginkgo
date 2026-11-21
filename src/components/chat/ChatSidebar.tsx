"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Hint } from "@/components/ui/hint";
import {
  Plus,
  History,
  Compass,
  Search,
  Trash2,
  FileCode,
  Sparkles,
  LayoutGrid,
  Eye,
  RefreshCw,
  Edit3,
  Check,
  Star,
  Download,
  Upload,
  BookOpen,
  MoreHorizontal,
  Bookmark,
  Copy,
  Folder,
  FolderPlus,
  Box,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { SessionSummary } from "@/lib/sessionStore";
import type { WorkspaceRecord } from "@/lib/workspaceStore";
import { toast } from "@/lib/toast";
// 仅取类型（编译期擦除）
import type { DashboardSummary } from "@/lib/dashboardStore";
import type { PresetQuery } from "./useMethodologyPresets";
import { SessionListItem, formatSessionTime } from "./SessionListItem";
import { AppSwitcher } from "./AppSwitcher";
import { appRegistry } from "@/lib/apps/registry";

interface ChatSidebarProps {
  /** 当前应用 ID（缺省为 "analytics"） */
  activeAppId?: string;
  /** 切换应用回调 */
  onSwitchApp?: (appId: string) => void;
  sessions: SessionSummary[];
  currentSessionId: string;
  editingSessionId: string | null;
  editingTitleText: string;
  showRawLang: boolean;
  /** 看板收藏库（服务端存储，跨浏览器可用） */
  dashboards: DashboardSummary[];
  onPreviewDashboard: (id: string) => void;
  /** 重新分析：prompt 交回看板原会话（原会话已删除时上层报错终止；无来源记录回退当前会话） */
  onReanalyzeDashboard: (prompt?: string, originSessionId?: string) => void;
  onRenameDashboard: (id: string, title: string) => void;
  onDeleteDashboard: (id: string) => void;
  /** 导出快照：父层拉取完整记录后下载 .openui.json */
  onExportDashboard: (id: string) => void;
  /** 存为模板 / 取消模板（父层调 save-as-template 或 update kind=favorite） */
  onToggleDashboardTemplate: (id: string) => void;
  /** 用模板新建（父层弹换源选择后调 from-template） */
  onCreateDashboardFromTemplate: (id: string) => void;
  /** 导入快照：父层负责解析校验与落库（origin 置空） */
  onImportDashboard: (file: File) => void;
  onCreateNewChat: (opts?: { workspaceId?: string }) => void;
  onSelectSession: (sessionId: string) => void;
  onStartRename: (e: React.MouseEvent, session: SessionSummary) => void;
  onSaveRename: (sessionId: string) => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onEditTitleChange: (text: string) => void;
  onCancelEdit: () => void;
  onPresetSelect: (preset: string) => void;
  /** 推荐列表：方法卡 presetQuery 生成（内置兜底 + /api/methodology 合并卡集） */
  presetQueries: PresetQuery[];
  onToggleRawLang: () => void;
  /** 打开分析方法论查看弹窗 */
  onOpenMethodology: () => void;
  /** 打开可视化组件查看弹窗 */
  onOpenComponentCatalog: () => void;
}

export function ChatSidebar({
  activeAppId = "analytics",
  onSwitchApp,
  sessions,
  currentSessionId,
  editingSessionId,
  editingTitleText,
  showRawLang,
  dashboards,
  onPreviewDashboard,
  onReanalyzeDashboard,
  onRenameDashboard,
  onDeleteDashboard,
  onExportDashboard,
  onImportDashboard,
  onToggleDashboardTemplate,
  onCreateDashboardFromTemplate,
  onCreateNewChat,
  onSelectSession,
  onStartRename,
  onSaveRename,
  onDeleteSession,
  onEditTitleChange,
  onCancelEdit,
  onPresetSelect,
  presetQueries,
  onToggleRawLang,
  onOpenMethodology,
  onOpenComponentCatalog,
}: ChatSidebarProps) {
  const currentApp = useMemo(
    () => appRegistry.getOrDefault(activeAppId),
    [activeAppId]
  );
  const appTabs = useMemo(
    () => currentApp.client.sidebarTabs ?? [],
    [currentApp.client.sidebarTabs]
  );

  const [rawSidebarTab, setSidebarTab] = useState<string>("history");
  // 派生有效 tab：若当前选中 tab 不在有效列表中，自动平滑 fallback 到 "history"
  const effectiveTab =
    rawSidebarTab === "history" || appTabs.some((t) => t.key === rawSidebarTab)
      ? rawSidebarTab
      : "history";

  const activeTabSpec = appTabs.find((t) => t.key === effectiveTab);

  // 解析当前应用可用的推荐项（数据分析走方法卡，通用应用走自治 presetQueries）
  const appPresets = useMemo(() => {
    if (activeAppId === "analytics" && presetQueries.length > 0) {
      return presetQueries.map((p) => ({
        id: p.id,
        title: p.name,
        query: p.query,
      }));
    }
    return (currentApp.client.presetQueries ?? []).map((p, idx) => ({
      id: p.id ?? `preset-${idx}`,
      title: p.category ?? "推荐",
      query: p.text,
    }));
  }, [activeAppId, presetQueries, currentApp.client.presetQueries]);

  const [sessionSearch, setSessionSearch] = useState("");
  // 快照导入：隐藏 file input（选择后清空 value，允许重复导入同一文件）
  const importFileRef = useRef<HTMLInputElement>(null);

  // 工作区状态与折叠管理
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({});
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const [isPickingFolder, setIsPickingFolder] = useState(false);

  const fetchWorkspaces = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces?appId=${encodeURIComponent(activeAppId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.workspaces)) {
          setWorkspaces(data.workspaces);
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.error("[ChatSidebar] 获取工作区列表失败:", err);
      }
    }
  }, [activeAppId]);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (!isCancelled) {
        await fetchWorkspaces();
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [fetchWorkspaces]);

  // 删除自定义工作区
  const handleDeleteWorkspace = async (e: React.MouseEvent, ws: WorkspaceRecord) => {
    e.stopPropagation();
    if (typeof window !== "undefined" && !window.confirm(`确定删除工作区「${ws.name}」吗？`)) {
      return;
    }
    try {
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(ws.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast(`已删除工作区: ${ws.name}`, "success");
        await fetchWorkspaces();
        // 如果当前会话属于被删除的工作区，平滑切换到其他会话或新建默认会话
        const curSession = sessions.find((s) => s.id === currentSessionId);
        if (curSession?.workspaceId === ws.id) {
          const fallbackSession = sessions.find((s) => s.workspaceId !== ws.id);
          if (fallbackSession) {
            onSelectSession(fallbackSession.id);
          } else {
            onCreateNewChat({ workspaceId: "ws_default" });
          }
        }
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "删除工作区失败", "error");
      }
    } catch {
      toast("删除工作区请求失败", "error");
    }
  };

  // 点击新建工作区：调用系统原生 Finder 文件夹选择对话框
  const handlePickFolder = async () => {
    try {
      setIsPickingFolder(true);
      const res = await fetch("/api/workspace/pick-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: activeAppId }),
      });
      const data = await res.json();
      if (data.canceled) {
        return;
      }
      if (data.success && data.workspace) {
        toast(`已成功挂载工作区: ${data.workspace.name}`, "success");
        await fetchWorkspaces();
        // 自动在该新工程工作区下创建会话
        onCreateNewChat({ workspaceId: data.workspace.id });
      } else if (data.error) {
        toast(data.error, "error");
      }
    } catch {
      toast("唤起系统文件夹选择器失败", "error");
    } finally {
      setIsPickingFolder(false);
    }
  };

  // 过滤后的会话列表
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  // 会话按工作区归类分组（若会话绑定的工作区已被删除，自动安全归入默认工作区，防止历史孤儿不可见）
  const sessionsByWorkspace = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const ws of workspaces) {
      map.set(ws.id, []);
    }
    // 确保默认工作区键存在
    if (!map.has("ws_default")) {
      map.set("ws_default", []);
    }
    const validWsIds = new Set(workspaces.map((w) => w.id));
    for (const s of filteredSessions) {
      const wsId = s.workspaceId && validWsIds.has(s.workspaceId) ? s.workspaceId : "ws_default";
      if (!map.has(wsId)) {
        map.set(wsId, []);
      }
      map.get(wsId)!.push(s);
    }
    return map;
  }, [workspaces, filteredSessions]);

  // 当前活跃会话所属的工作区 ID，供顶部「新建会话」时自然继承
  const currentSessionWorkspaceId = useMemo(() => {
    const active = sessions.find((s) => s.id === currentSessionId);
    return active?.workspaceId;
  }, [sessions, currentSessionId]);

  return (
    <aside className="w-72 border-r border-border bg-card flex flex-col shrink-0">
      {/* 顶部应用切换器 */}
      <div className="p-3 border-b border-border-subtle">
        <AppSwitcher
          activeAppId={activeAppId}
          onSwitchApp={onSwitchApp ?? (() => {})}
        />
      </div>

      {/* 顶部操作：新建会话与新建工作区 */}
      <div className="p-3 border-b border-border-subtle flex items-center gap-2">
        <button
          onClick={() => onCreateNewChat({ workspaceId: currentSessionWorkspaceId })}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-foreground hover:bg-foreground-strong text-background text-xs font-medium shadow-2xs active:scale-[0.99] transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>新建会话</span>
        </button>
        {activeAppId !== "analytics" && (
          <button
            onClick={handlePickFolder}
            disabled={isPickingFolder}
            className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg border border-border text-foreground-subtle hover:text-foreground hover:bg-muted text-xs font-medium transition-all shrink-0"
            title="选择系统本地文件夹挂载为工作区"
          >
            <FolderPlus className={`w-3.5 h-3.5 text-brand-fg ${isPickingFolder ? "animate-spin" : ""}`} />
            <span>新建工作区</span>
          </button>
        )}
      </div>

      {/* 侧边栏导航 Tab 切换 */}
      <div className="px-3 pt-2">
        <div className="flex bg-muted p-1 rounded-lg text-xs font-medium gap-0.5">
          <button
            onClick={() => setSidebarTab("history")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              effectiveTab === "history"
                ? "bg-card text-info-fg shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>历史 ({sessions.length})</span>
          </button>
          {appTabs.map((tab) => {
            const countBadge =
              tab.key === "dashboards" ? ` (${dashboards.length})` : "";

            const IconComp =
              tab.icon === "LayoutGrid" || tab.key === "dashboards"
                ? LayoutGrid
                : tab.icon === "Compass" || tab.key === "presets"
                ? Compass
                : tab.icon === "Sparkles"
                ? Sparkles
                : tab.icon === "Star"
                ? Star
                : tab.icon === "BookOpen"
                ? BookOpen
                : Compass;

            return (
              <button
                key={tab.key}
                onClick={() => setSidebarTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
                  effectiveTab === tab.key
                    ? "bg-card text-info-fg shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <IconComp className="w-3.5 h-3.5" />
                <span>
                  {tab.label}
                  {countBadge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 历史会话列表视图：按工作区分组平铺展开 */}
      {effectiveTab === "history" && (
        <div className="flex-1 flex flex-col min-h-0 px-3 py-2 space-y-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-foreground-faint" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="搜索历史会话..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-surface-sunken border border-border/80 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* 工作区列表平铺展开 */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {filteredSessions.length === 0 && workspaces.length === 0 ? (
              <div className="text-center py-8 text-xs text-foreground-faint">
                无匹配的会话记录
              </div>
            ) : (
              (workspaces.length > 0
                ? workspaces
                : [{ id: "ws_default", name: "默认工作区", appId: activeAppId, createdAt: 0, updatedAt: 0 }]
              ).map((ws) => {
                const groupSessions = sessionsByWorkspace.get(ws.id) ?? [];
                // 如果搜索中且该工作区无匹配会话，跳过展示
                if (sessionSearch.trim() && groupSessions.length === 0) return null;

                const isCollapsed = Boolean(collapsedWorkspaces[ws.id]);
                const isExpanded = Boolean(expandedWorkspaces[ws.id]);
                const visibleSessions = isExpanded
                  ? groupSessions
                  : groupSessions.slice(0, 5);

                return (
                  <div key={ws.id} className="space-y-0.5">
                    {/* 工作区分组头：点击整行可折叠展开 */}
                    <div
                      onClick={() =>
                        setCollapsedWorkspaces((prev) => ({
                          ...prev,
                          [ws.id]: !prev[ws.id],
                        }))
                      }
                      className="flex items-center justify-between px-1.5 py-1 text-xs text-foreground-subtle group rounded-md hover:bg-muted/60 cursor-pointer select-none transition-colors"
                    >
                      <div
                        className="flex items-center gap-1.5 min-w-0 flex-1 truncate"
                        title={ws.path ? `本地物理工程目录: ${ws.path}` : "默认沙箱环境"}
                      >
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-foreground-faint shrink-0 transition-transform ${
                            isCollapsed ? "" : "rotate-90"
                          }`}
                        />
                        {ws.path ? (
                          <Folder className="w-3.5 h-3.5 text-brand-fg shrink-0" />
                        ) : (
                          <Box className="w-3.5 h-3.5 text-info-fg shrink-0" />
                        )}
                        <span className="truncate text-foreground font-medium text-[12px]">
                          {ws.name}
                        </span>
                        <span className="text-[11px] text-foreground-faint shrink-0">
                          ({groupSessions.length})
                        </span>
                      </div>

                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onCreateNewChat({ workspaceId: ws.id })}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-foreground-subtle hover:text-foreground transition-all"
                          title={`在「${ws.name}」下新建会话`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>

                        {ws.id !== "ws_default" && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteWorkspace(e, ws)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-danger-soft rounded text-foreground-faint hover:text-danger-fg transition-all"
                            title={`删除工作区「${ws.name}」`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 所属会话列表（未折叠时展示） */}
                    {!isCollapsed && (
                      <div className="space-y-0.5 pl-2">
                        {groupSessions.length === 0 ? (
                          <div className="px-3 py-1 text-[11px] text-foreground-faint">
                            暂无会话
                          </div>
                        ) : (
                          visibleSessions.map((session) => (
                            <SessionListItem
                              key={session.id}
                              session={session}
                              isActive={session.id === currentSessionId}
                              isEditing={editingSessionId === session.id}
                              editingTitleText={editingTitleText}
                              onSelect={onSelectSession}
                              onStartRename={onStartRename}
                              onSaveRename={onSaveRename}
                              onDelete={onDeleteSession}
                              onEditTitleChange={onEditTitleChange}
                              onCancelEdit={onCancelEdit}
                            />
                          ))
                        )}

                        {/* 超过 5 条自动折叠，展示全部操作 */}
                        {groupSessions.length > 5 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedWorkspaces((prev) => ({
                                ...prev,
                                [ws.id]: !prev[ws.id],
                              }))
                            }
                            className="w-full text-center py-1 text-[11px] text-foreground-subtle hover:text-foreground hover:bg-muted/60 rounded transition-colors flex items-center justify-center gap-1"
                          >
                            <span>
                              {isExpanded
                                ? "收起部分会话"
                                : `展示全部 (共 ${groupSessions.length} 条)`}
                            </span>
                            <ChevronDown
                              className={`w-3 h-3 transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 应用自治自定义组件 Tab */}
      {effectiveTab !== "history" && activeTabSpec?.Component && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <activeTabSpec.Component
            appId={activeAppId}
            onSelectPrompt={onPresetSelect}
          />
        </div>
      )}

      {/* 内置看板收藏库视图 */}
      {effectiveTab === "dashboards" && !activeTabSpec?.Component && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <div className="text-[11px] font-semibold text-foreground-faint uppercase tracking-wider truncate">
              收藏的看板（服务端存储）
            </div>
            <Hint label="导入 .openui.json 快照文件">
              <button
                onClick={() => importFileRef.current?.click()}
                aria-label="导入看板快照"
                className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-info-fg px-1.5 py-1 rounded-lg hover:bg-info-soft transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>导入</span>
              </button>
            </Hint>
            <input
              ref={importFileRef}
              type="file"
              accept=".json,application/json"
              aria-label="导入看板快照文件"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportDashboard(file);
                e.target.value = "";
              }}
            />
          </div>
          {dashboards.length === 0 ? (
            <div className="text-center py-10 px-3 text-xs text-foreground-faint leading-relaxed">
              <Star className="w-5 h-5 mx-auto mb-2 text-foreground-faint" />
              还没有收藏的看板
              <br />
              对话生成看板后，点击看板右上角 <span className="text-warning-fg">★ 收藏</span> 保存到这里
            </div>
          ) : (
            dashboards.map((d) => (
              <DashboardListItem
                key={d.id}
                dashboard={d}
                onPreview={onPreviewDashboard}
                onReanalyze={onReanalyzeDashboard}
                onRename={onRenameDashboard}
                onDelete={onDeleteDashboard}
                onExport={onExportDashboard}
                onToggleTemplate={onToggleDashboardTemplate}
                onCreateFromTemplate={onCreateDashboardFromTemplate}
              />
            ))
          )}
        </div>
      )}

      {/* 预设推荐场景视图 */}
      {effectiveTab === "presets" && !activeTabSpec?.Component && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-foreground-faint uppercase tracking-wider px-1 pb-1">
            {activeTabSpec?.description || "推荐场景与指令"}
          </div>
          {appPresets.length === 0 ? (
            <div className="text-center py-8 text-xs text-foreground-faint">
              当前应用暂无推荐场景
            </div>
          ) : (
            appPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onPresetSelect(preset.query)}
                className="w-full text-left text-xs p-2.5 rounded-lg hover:bg-muted text-foreground-subtle transition-colors flex items-start gap-2"
              >
                <Sparkles className="w-3.5 h-3.5 text-info-fg shrink-0 mt-0.5" />
                <span className="line-clamp-2 leading-relaxed">
                  <span className="text-foreground-faint">[{preset.title}]</span>{" "}
                  {preset.query}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 底部功能栏 */}
      <div className="p-3 border-t border-border-subtle space-y-1.5 bg-surface-sunken/50">
        <button
          onClick={onToggleRawLang}
          className={`w-full text-xs p-2 rounded-lg border transition-colors flex items-center gap-2 ${
            showRawLang
              ? "bg-info-soft border-info-border text-info-fg font-medium"
              : "border-border text-foreground-subtle hover:bg-muted"
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>{showRawLang ? "隐藏 OpenUI 源码" : "查看 OpenUI Lang 源码"}</span>
        </button>
        {/* 应用声明的快捷操作：通用渲染（label/icon 生效；onClick 缺省解析宿主内置能力） */}
        {(currentApp.client.sidebarQuickActions ?? []).map((action) => {
          const hostHandler =
            action.key === "methodology"
              ? onOpenMethodology
              : action.key === "component-catalog"
                ? onOpenComponentCatalog
                : undefined;
          const handler = action.onClick ?? hostHandler;
          if (!handler) return null;
          const ActionIcon =
            action.icon === "BookOpen"
              ? BookOpen
              : action.icon === "LayoutGrid"
                ? LayoutGrid
                : action.icon === "Sparkles"
                  ? Sparkles
                  : Compass;
          return (
            <button
              key={action.key}
              onClick={handler}
              className="w-full text-xs p-2 rounded-lg border border-border text-foreground-subtle hover:bg-muted transition-colors flex items-center gap-2"
            >
              <ActionIcon className="w-3.5 h-3.5" />
              <span>{action.label}</span>
            </button>
          );
        })}
        <button
          onClick={onOpenComponentCatalog}
          className="w-full text-xs p-2 rounded-lg border border-border text-foreground-subtle hover:bg-muted transition-colors flex items-center gap-2"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>可视化组件</span>
        </button>
      </div>
    </aside>
  );
}

/** 看板收藏列表项：外露仅「查看」，其余操作收纳进「...」下拉菜单（删除二次确认在菜单内完成） */
function DashboardListItem({
  dashboard,
  onPreview,
  onReanalyze,
  onRename,
  onDelete,
  onExport,
  onToggleTemplate,
  onCreateFromTemplate,
}: {
  dashboard: DashboardSummary;
  onPreview: (id: string) => void;
  onReanalyze: (prompt?: string, originSessionId?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  /** 存为模板（收藏）/ 取消模板（模板） */
  onToggleTemplate: (id: string) => void;
  /** 用模板新建（仅模板项出现） */
  onCreateFromTemplate: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dashboard.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 菜单关闭（任意路径）时复位删除确认态
  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  // 菜单外点击 / Escape 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const saveRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== dashboard.title) onRename(dashboard.id, trimmed);
    setEditing(false);
  };

  const menuItemClass =
    "w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div
      onClick={() => !editing && onPreview(dashboard.id)}
      className="group relative flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer transition-all border border-transparent hover:bg-muted/80 text-foreground-subtle"
    >
      <div className="min-w-0 flex-1 pr-1">
        {editing ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label={`重命名看板 ${dashboard.title}`}
              className="flex-1 min-w-0 px-2 py-1 bg-surface-sunken border border-info-border-strong rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={saveRename}
              aria-label="保存标题"
              className="p-1 rounded text-success-fg hover:bg-success-soft"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <Star className="w-3 h-3 text-warning-fg fill-current shrink-0" />
              <span className="font-medium truncate">{dashboard.title}</span>
              {dashboard.kind === "template" && (
                <span className="shrink-0 px-1 py-0.5 rounded bg-info-soft text-info-fg text-[10px] font-medium">
                  模板
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-foreground-faint truncate">
              {dashboard.prompt ? dashboard.prompt : "（未记录原始提问）"}
            </div>
            {/* 第 3 行：时间信息（收藏时间 + 数据时间，中点分隔） */}
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-foreground-faint">
              <span className="shrink-0" title={`收藏于 ${new Date(dashboard.updatedAt).toLocaleString()}`}>
                {formatSessionTime(dashboard.updatedAt)}
              </span>
              {dashboard.dataUpdatedAt !== undefined && (
                <>
                  <span className="text-foreground-faint">·</span>
                  <span
                    className="shrink-0 text-success-fg/80"
                    title={`数据确认于 ${new Date(dashboard.dataUpdatedAt).toLocaleString()}`}
                  >
                    数据 {formatSessionTime(dashboard.dataUpdatedAt)}
                  </span>
                </>
              )}
            </div>
            {/* 第 4 行：数据源徽章（多源只显首个 +「+N」，全量悬停可见） */}
            {dashboard.sourceNames && dashboard.sourceNames.length > 0 && (
              <div className="mt-1 flex items-center gap-1 min-w-0">
                <span className="px-1 py-0.5 rounded bg-muted text-[10px] text-foreground-faint truncate">
                  {dashboard.sourceNames[0]}
                </span>
                {dashboard.sourceNames.length > 1 && (
                  <span
                    className="shrink-0 text-[10px] text-foreground-faint cursor-default"
                    title={dashboard.sourceNames.join(" / ")}
                  >
                    +{dashboard.sourceNames.length - 1}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 行内操作：仅外露「查看」；其余收纳进「...」菜单（编辑态隐藏；点击不冒泡到行预览） */}
      {!editing && (
        <div
          className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <Hint label="查看看板">
            <button
              onClick={() => onPreview(dashboard.id)}
              aria-label={`查看看板 ${dashboard.title}`}
              className="p-1.5 rounded-lg text-foreground-faint hover:text-info-fg hover:bg-info-soft"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </Hint>

          <div className="relative" ref={menuRef}>
            <Hint label="更多操作">
              <button
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                aria-label={`看板 ${dashboard.title} 更多操作`}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="p-1.5 rounded-lg text-foreground-faint hover:text-foreground-subtle hover:bg-muted"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </Hint>

            {menuOpen && (
              <div
                role="menu"
                aria-label={`看板 ${dashboard.title} 操作菜单`}
                className="absolute right-0 top-full mt-1 z-30 w-40 rounded-xl border border-border bg-card shadow-lg py-1"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onReanalyze(dashboard.prompt, dashboard.origin?.sessionId);
                  }}
                  disabled={!dashboard.prompt}
                  aria-label={`重新分析 ${dashboard.title}`}
                  title={dashboard.prompt ? "用原始提问重新分析" : "未记录原始提问"}
                  className={menuItemClass}
                >
                  <RefreshCw className="w-3.5 h-3.5 text-foreground-faint" />
                  <span>重新分析</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onToggleTemplate(dashboard.id);
                  }}
                  aria-label={dashboard.kind === "template" ? `取消模板 ${dashboard.title}` : `存为模板 ${dashboard.title}`}
                  className={menuItemClass}
                >
                  <Bookmark className="w-3.5 h-3.5 text-foreground-faint" />
                  <span>{dashboard.kind === "template" ? "取消模板" : "存为模板"}</span>
                </button>
                {dashboard.kind === "template" && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      onCreateFromTemplate(dashboard.id);
                    }}
                    aria-label={`用模板新建 ${dashboard.title}`}
                    className={menuItemClass}
                  >
                    <Copy className="w-3.5 h-3.5 text-foreground-faint" />
                    <span>用模板新建</span>
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onExport(dashboard.id);
                  }}
                  aria-label={`导出看板 ${dashboard.title}`}
                  className={menuItemClass}
                >
                  <Download className="w-3.5 h-3.5 text-foreground-faint" />
                  <span>导出快照</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    setDraft(dashboard.title);
                    setEditing(true);
                  }}
                  aria-label={`重命名看板 ${dashboard.title}`}
                  className={menuItemClass}
                >
                  <Edit3 className="w-3.5 h-3.5 text-foreground-faint" />
                  <span>重命名</span>
                </button>
                <div className="my-1 border-t border-border-subtle" />
                {confirmDelete ? (
                  <button
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      onDelete(dashboard.id);
                    }}
                    aria-label={`确认删除看板 ${dashboard.title}`}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-danger-fg bg-danger-soft hover:bg-danger-soft-hover transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>确认删除</span>
                  </button>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => setConfirmDelete(true)}
                    aria-label={`删除看板 ${dashboard.title}`}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-danger-fg hover:bg-danger-soft transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除收藏</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
