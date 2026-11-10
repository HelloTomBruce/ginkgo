"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Hint } from "@/components/ui/hint";
import {
  BarChart3,
  Plus,
  History,
  Compass,
  Search,
  Trash2,
  Bot,
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
} from "lucide-react";
import type { SessionSummary } from "@/lib/sessionStore";
// 仅取类型（编译期擦除）
import type { DashboardSummary } from "@/lib/dashboardStore";
import type { PresetQuery } from "./useMethodologyPresets";
import { SessionListItem, formatSessionTime } from "./SessionListItem";

interface ChatSidebarProps {
  sessions: SessionSummary[];
  currentSessionId: string;
  editingSessionId: string | null;
  editingTitleText: string;
  apiKey: string;
  model: string;
  showRawLang: boolean;
  /** 看板收藏库（服务端存储，跨浏览器可用） */
  dashboards: DashboardSummary[];
  onPreviewDashboard: (id: string) => void;
  /** 重新分析：prompt 交回当前会话；未记录提问时由上层提示 */
  onReanalyzeDashboard: (prompt?: string) => void;
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
  onCreateNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onStartRename: (e: React.MouseEvent, session: SessionSummary) => void;
  onSaveRename: (sessionId: string) => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onEditTitleChange: (text: string) => void;
  onCancelEdit: () => void;
  onClearAllSessions: () => void;
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
  sessions,
  currentSessionId,
  editingSessionId,
  editingTitleText,
  apiKey,
  model,
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
  onClearAllSessions,
  onPresetSelect,
  presetQueries,
  onToggleRawLang,
  onOpenMethodology,
  onOpenComponentCatalog,
}: ChatSidebarProps) {
  const [sidebarTab, setSidebarTab] = useState<
    "history" | "dashboards" | "presets"
  >("history");
  const [sessionSearch, setSessionSearch] = useState("");
  // 快照导入：隐藏 file input（选择后清空 value，允许重复导入同一文件）
  const importFileRef = useRef<HTMLInputElement>(null);

  // 过滤后的会话列表
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  return (
    <aside className="w-72 border-r border-border bg-card flex flex-col shrink-0">
      {/* Logo 区域 */}
      <div className="flex items-center gap-2.5 p-4 border-b border-border-subtle">
        <div className="w-8 h-8 rounded-lg bg-info-solid flex items-center justify-center text-white shadow-xs">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm leading-tight truncate">OpenUI Analytics</h1>
          <p className="text-[11px] text-foreground-faint">Generative UI & MCP</p>
        </div>
      </div>

      {/* 顶部操作：新建会话按钮 */}
      <div className="p-3 border-b border-border-subtle">
        <button
          onClick={onCreateNewChat}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-info-solid hover:bg-info-solid-hover text-white text-xs font-semibold shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>新建会话</span>
        </button>
      </div>

      {/* 侧边栏导航 Tab 切换 */}
      <div className="px-3 pt-2">
        <div className="flex bg-muted p-1 rounded-lg text-xs font-medium">
          <button
            onClick={() => setSidebarTab("history")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              sidebarTab === "history"
                ? "bg-card text-info-fg shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>历史 ({sessions.length})</span>
          </button>
          <button
            onClick={() => setSidebarTab("dashboards")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              sidebarTab === "dashboards"
                ? "bg-card text-info-fg shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>看板 ({dashboards.length})</span>
          </button>
          <button
            onClick={() => setSidebarTab("presets")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              sidebarTab === "presets"
                ? "bg-card text-info-fg shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>推荐</span>
          </button>
        </div>
      </div>

      {/* 历史会话列表视图 */}
      {sidebarTab === "history" && (
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

          {/* 会话列表项 */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredSessions.length === 0 ? (
              <div className="text-center py-8 text-xs text-foreground-faint">
                无匹配的会话记录
              </div>
            ) : (
              filteredSessions.map((session) => (
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
          </div>

          {/* 清空历史按钮 */}
          <div className="pt-1 border-t border-border-subtle flex justify-end">
            <button
              onClick={onClearAllSessions}
              className="text-[11px] text-foreground-faint hover:text-danger-fg py-1 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>清空所有记录</span>
            </button>
          </div>
        </div>
      )}

      {/* 看板收藏库视图 */}
      {sidebarTab === "dashboards" && (
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
      {sidebarTab === "presets" && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-foreground-faint uppercase tracking-wider px-1 pb-1">
            一键带入分析模板（按方法卡生成）
          </div>
          {presetQueries.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onPresetSelect(preset.query)}
              className="w-full text-left text-xs p-2.5 rounded-lg hover:bg-muted text-foreground-subtle transition-colors flex items-start gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-info-fg shrink-0 mt-0.5" />
              <span className="line-clamp-2 leading-relaxed">
                <span className="text-foreground-faint">[{preset.name}]</span>{" "}
                {preset.query}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 底部功能栏与运行状态 */}
      <div className="p-3 border-t border-border-subtle space-y-2 bg-surface-sunken/50">
        <div className="flex items-center justify-between text-[11px] px-1 text-muted-foreground">
          <div className="flex items-center gap-1.5 font-medium">
            <Bot className="w-3.5 h-3.5 text-info-fg" />
            <span>{apiKey ? model : "未配置 Key"}</span>
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
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
          <button
            onClick={onOpenMethodology}
            className="w-full text-xs p-2 rounded-lg border border-border text-foreground-subtle hover:bg-muted transition-colors flex items-center gap-2"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>分析方法论</span>
          </button>
          <button
            onClick={onOpenComponentCatalog}
            className="w-full text-xs p-2 rounded-lg border border-border text-foreground-subtle hover:bg-muted transition-colors flex items-center gap-2"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>可视化组件</span>
          </button>
        </div>
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
  onReanalyze: (prompt?: string) => void;
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
                    onReanalyze(dashboard.prompt);
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
