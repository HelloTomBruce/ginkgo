"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Loader2,
  Check,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Copy,
  TrendingUp,
  Bot,
  Palette,
  Boxes,
  X,
  RotateCcw,
} from "lucide-react";
import {
  describeAppPermission,
  type AppHealthCheckResult,
} from "@ginkgolab/app-sdk";
import { toast } from "@/lib/toast";

export interface AppStoreItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category?: string;
  package?: string;
  enabled: boolean;
  builtin: boolean;
  isRegistered: boolean;
  /** 载入失败原因（未注册时有值） */
  loadError?: string;
  /** 健康检查结果（与 SDK 契约同源，避免本地重复定义漂移） */
  health: AppHealthCheckResult;
}

export interface AppStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAppsChanged?: () => void;
}

function renderAppIcon(iconName: string, className = "w-5 h-5") {
  switch (iconName?.toLowerCase()) {
    case "trendingup":
    case "barchart3":
      return <TrendingUp className={className} />;
    case "bot":
    case "sparkles":
      return <Bot className={className} />;
    case "palette":
      return <Palette className={className} />;
    default:
      return <Boxes className={className} />;
  }
}

export function AppStoreModal({
  isOpen,
  onClose,
  onAppsChanged,
}: AppStoreModalProps) {
  const [apps, setApps] = useState<AppStoreItem[]>([]);
  // 挂载即视为加载中：避免在 effect 内同步 setState 触发级联渲染
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isInstalling, setIsInstalling] = useState(false);
  const [installPackageInput, setInstallPackageInput] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [remediationTarget, setRemediationTarget] = useState<AppStoreItem | null>(null);
  /** 权限握手第一步的产物：待用户确认的权限清单 */
  const [pendingPermissions, setPendingPermissions] = useState<{
    name?: string;
    packageSpec: string;
    permissions: string[];
  } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  /** 取数唯一实现（挂载 effect 与手动刷新共用，避免两份 fetch 逻辑漂移） */
  const loadApps = useCallback(async (signal?: AbortSignal): Promise<AppStoreItem[]> => {
    const res = await fetch("/api/apps", signal ? { signal } : undefined);
    if (!res.ok) {
      throw new Error(`加载应用中心失败（HTTP ${res.status}）`);
    }
    const data = (await res.json()) as { apps?: AppStoreItem[] };
    return data.apps ?? [];
  }, []);

  /** 手动刷新（按钮/安装完成后） */
  const fetchApps = useCallback(async () => {
    setIsLoading(true);
    try {
      setApps(await loadApps());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [loadApps]);

  // 弹窗打开时加载（setState 只在 promise 回调里；关闭弹窗即中止请求）
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    loadApps(controller.signal)
      .then((items) => setApps(items))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        toast.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [isOpen, loadApps]);

  // 启停应用
  const handleToggle = async (appId: string, currentEnabled: boolean) => {
    const nextEnabled = !currentEnabled;
    try {
      const res = await fetch(`/api/apps/${appId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || `切换应用状态失败（HTTP ${res.status}）`);
        return;
      }
      setApps((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, enabled: nextEnabled } : a))
      );
      onAppsChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // 卸载应用
  const handleUninstall = async (appId: string) => {
    if (!window.confirm(`确定要卸载应用 [${appId}] 吗？`)) return;
    try {
      const res = await fetch(`/api/apps/${appId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || `卸载失败（HTTP ${res.status}）`);
        return;
      }
      setApps((prev) => prev.filter((a) => a.id !== appId));
      toast.success("应用已卸载");
      onAppsChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * 动态安装包（两段握手）。
   *
   * 声明了 permissions 的第三方包不会直接启用：服务端返回 409 + 权限清单，
   * 用户在弹窗内确认后才带上 acknowledgedPermissions 重试。
   */
  const postInstall = useCallback(
    async (packageSpec: string, acknowledgedPermissions?: string[]) => {
      const res = await fetch("/api/apps/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageSpec,
          enableImmediately: true,
          ...(acknowledgedPermissions
            ? { acknowledgedPermissions }
            : {}),
        }),
      });
      return { res, data: await res.json() };
    },
    []
  );

  const handleInstallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pkg = installPackageInput.trim();
    if (!pkg) return;

    setIsInstalling(true);
    setInstallError(null);
    setPendingPermissions(null);

    try {
      const { res, data } = await postInstall(pkg);

      if (res.status === 409 && Array.isArray(data.requiredPermissions)) {
        setPendingPermissions({
          name: data.name,
          packageSpec: pkg,
          permissions: data.requiredPermissions,
        });
        return;
      }
      if (!res.ok) {
        setInstallError(data.error || "安装失败，请检查包名或网络连接");
        return;
      }
      setInstallPackageInput("");
      await fetchApps();
      onAppsChanged?.();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInstalling(false);
    }
  };

  /** 用户确认权限后重试安装 */
  const handleConfirmPermissions = async () => {
    if (!pendingPermissions) return;
    setIsInstalling(true);
    setInstallError(null);
    try {
      const { res, data } = await postInstall(
        pendingPermissions.packageSpec,
        pendingPermissions.permissions
      );
      if (!res.ok) {
        setInstallError(data.error || "安装失败");
        return;
      }
      setPendingPermissions(null);
      setInstallPackageInput("");
      await fetchApps();
      onAppsChanged?.();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInstalling(false);
    }
  };

  // 复制自愈安装命令
  const handleCopyRemediation = (guide: string) => {
    void navigator.clipboard.writeText(guide).then(() => {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    });
  };

  // 提取可用分类
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of apps) {
      if (a.category) set.add(a.category);
    }
    return Array.from(set);
  }, [apps]);

  // 过滤后的列表
  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      // 类别过滤
      if (selectedCategory === "installed" && !app.enabled) return false;
      if (
        selectedCategory !== "all" &&
        selectedCategory !== "installed" &&
        app.category !== selectedCategory
      ) {
        return false;
      }
      // 关键词过滤
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = app.name.toLowerCase().includes(q);
        const matchDesc = app.description.toLowerCase().includes(q);
        const matchId = app.id.toLowerCase().includes(q);
        return matchName || matchDesc || matchId;
      }
      return true;
    });
  }, [apps, selectedCategory, searchQuery]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] sm:max-w-3xl lg:max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-card border border-border p-6 gap-4 text-xs overflow-hidden"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-info-soft text-info-fg flex items-center justify-center shrink-0">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="font-bold text-sm text-foreground flex items-center gap-2">
                Ginkgo 应用中心 (App Store)
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-surface-sunken text-foreground-subtle border border-border">
                  已启用 {apps.filter((a) => a.enabled).length} / {apps.length}
                </span>
              </DialogTitle>
              <p className="text-[11px] text-foreground-subtle mt-0.5">
                发现并管理智能体领域应用，支持配置驱动启停与第三方 npm 插件热插拔
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchApps()}
              disabled={isLoading}
              title="刷新应用状态"
              className="p-1.5 rounded-lg border border-border text-foreground-subtle hover:text-foreground hover:bg-surface-sunken transition-colors cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="text-foreground-subtle hover:text-foreground cursor-pointer p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 搜索与分类栏 */}
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索应用名称、描述或 ID..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface-sunken text-foreground placeholder:text-foreground-faint text-xs focus:outline-hidden focus:border-border-strong transition-colors"
            />
          </div>

          {/* 分类胶囊按钮 */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                selectedCategory === "all"
                  ? "bg-foreground text-background"
                  : "bg-surface-sunken text-foreground-subtle hover:text-foreground border border-border"
              }`}
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory("installed")}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                selectedCategory === "installed"
                  ? "bg-foreground text-background"
                  : "bg-surface-sunken text-foreground-subtle hover:text-foreground border border-border"
              }`}
            >
              已启用
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  selectedCategory === cat
                    ? "bg-foreground text-background"
                    : "bg-surface-sunken text-foreground-subtle hover:text-foreground border border-border"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 动态安装自定义 npm 包工具栏 */}
        <form
          onSubmit={handleInstallSubmit}
          className="p-2.5 rounded-xl border border-border bg-surface-sunken/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0"
        >
          <div className="flex-1 flex items-center gap-2">
            <span className="font-semibold text-foreground shrink-0 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" />
              安装应用:
            </span>
            <input
              type="text"
              value={installPackageInput}
              onChange={(e) => setInstallPackageInput(e.target.value)}
              placeholder="输入 npm 包名或本地路径，如 @ginkgolab/app-design..."
              className="flex-1 px-2.5 py-1 rounded-md border border-border bg-card text-foreground placeholder:text-foreground-faint text-xs focus:outline-hidden"
            />
          </div>
          <button
            type="submit"
            disabled={isInstalling || !installPackageInput.trim()}
            className="px-3 py-1 rounded-md bg-foreground text-background font-medium hover:bg-foreground-strong disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            {isInstalling ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>正在拉取安装...</span>
              </>
            ) : (
              <span>安装并激活</span>
            )}
          </button>
        </form>

        {/* 权限确认（两段握手第二步） */}
        {pendingPermissions && (
          <div
            className="p-3.5 rounded-xl border border-warning-border bg-warning-soft/30 text-xs space-y-2.5 shrink-0"
            data-testid="permission-confirm-panel"
          >
            <div className="flex items-center gap-1.5 font-semibold text-warning-fg">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                应用 [{pendingPermissions.name || pendingPermissions.packageSpec}] 申请以下权限
              </span>
            </div>
            <ul className="space-y-1 pl-1">
              {pendingPermissions.permissions.map((permission) => (
                <li key={permission} className="flex items-start gap-1.5 text-foreground-subtle">
                  <span className="mt-1 w-1 h-1 rounded-full bg-foreground-faint shrink-0" />
                  <span>
                    <code className="text-foreground font-mono text-[11px]">{permission}</code>
                    <span className="ml-1.5">{describeAppPermission(permission)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-foreground-faint">
              包已下载但尚未启用；未声明的工具一律不会被挂载（default deny）。
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmPermissions()}
                disabled={isInstalling}
                className="px-3 py-1 rounded-md bg-foreground text-background font-medium hover:bg-foreground-strong disabled:opacity-50 transition-colors cursor-pointer"
                data-testid="confirm-permissions-button"
              >
                确认并启用
              </button>
              <button
                type="button"
                onClick={() => setPendingPermissions(null)}
                className="px-3 py-1 rounded-md border border-border text-foreground-subtle hover:text-foreground transition-colors cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {installError && (
          <div className="p-2.5 rounded-lg bg-danger-soft/40 border border-danger-border text-danger-fg text-[11px] flex items-center justify-between">
            <span>{installError}</span>
            <button
              onClick={() => setInstallError(null)}
              className="p-0.5 hover:opacity-80"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* 应用卡片网格列表 */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {isLoading && apps.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-foreground-subtle gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>正在加载应用生态...</span>
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="py-12 text-center text-foreground-subtle">
              未找到匹配的应用
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredApps.map((app) => {
                const isHealthy = app.health.healthy;

                return (
                  <div
                    key={app.id}
                    className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                      app.enabled
                        ? "bg-card border-border shadow-2xs"
                        : "bg-surface-sunken/40 border-border/60 opacity-70"
                    }`}
                  >
                    <div>
                      {/* 卡片头部：图标、名称、徽标 */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-surface-sunken border border-border flex items-center justify-center text-foreground shrink-0 shadow-2xs">
                            {renderAppIcon(app.icon, "w-4 h-4")}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground text-xs leading-none truncate">
                                {app.name}
                              </span>
                              {app.category && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-info-soft text-info-fg shrink-0 font-normal">
                                  {app.category}
                                </span>
                              )}
                              {app.builtin && (
                                <span className="text-[10px] px-1 py-0.2 rounded bg-surface-sunken text-foreground-faint shrink-0 border border-border">
                                  内置
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-foreground-faint font-mono mt-0.5 block truncate">
                              ID: {app.id} {app.package ? `· ${app.package}` : ""}
                            </span>
                          </div>
                        </div>

                        {/* 启停开关 */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={app.enabled}
                            onClick={() => handleToggle(app.id, app.enabled)}
                            className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                              app.enabled ? "bg-info-fg" : "bg-border-strong"
                            }`}
                            title={app.enabled ? "点击停用" : "点击启用"}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-xs transition-transform ${
                                app.enabled ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* 描述文本 */}
                      <p className="text-[11px] text-foreground-subtle leading-relaxed mt-2.5 line-clamp-2">
                        {app.description || "暂无应用描述"}
                      </p>
                    </div>

                    {/* 卡片底部：健康状态与操作按钮 */}
                    <div className="border-t border-border-subtle pt-2 flex items-center justify-between text-[11px]">
                      {/* 健康指示 */}
                      <div className="flex items-center gap-1.5">
                        {isHealthy ? (
                          <span className="inline-flex items-center gap-1 text-success-fg">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>能力就绪</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRemediationTarget(app)}
                            className="inline-flex items-center gap-1 text-warning-fg hover:underline cursor-pointer"
                            title="点击查看修复指引"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>{app.isRegistered ? "依赖缺失 (点击自愈)" : "载入失败 (点击查看)"}</span>
                          </button>
                        )}
                      </div>

                      {/* 卸载操作（仅非内置应用支持） */}
                      {!app.builtin && (
                        <button
                          type="button"
                          onClick={() => handleUninstall(app.id)}
                          className="text-danger-fg hover:bg-danger-soft/40 p-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                          title="卸载应用"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>卸载</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 依赖自愈指引弹窗 */}
        {remediationTarget && (
          <div className="p-3.5 rounded-xl border border-warning-border bg-warning-soft/30 text-xs space-y-2.5 animate-in fade-in-0 duration-150">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-warning-fg flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                应用 [{remediationTarget.name}] 外部依赖自愈建议
              </span>
              <button
                type="button"
                onClick={() => setRemediationTarget(null)}
                className="text-foreground-subtle hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-foreground-subtle">
              {remediationTarget.health.message || "当前环境缺少该应用正常运行所需的外部工具。"}
            </p>
            {remediationTarget.loadError && (
              <p className="text-[11px] text-danger-fg font-mono break-all">
                {remediationTarget.loadError}
              </p>
            )}
            {remediationTarget.health.remediationGuide && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-surface-sunken border border-border font-mono text-[11px]">
                <code>{remediationTarget.health.remediationGuide}</code>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyRemediation(
                      remediationTarget.health.remediationGuide || ""
                    )
                  }
                  className="px-2 py-0.5 rounded bg-card hover:bg-surface-raised border border-border text-foreground transition-colors flex items-center gap-1 shrink-0 cursor-pointer text-[10px]"
                >
                  {copiedCmd ? (
                    <>
                      <Check className="w-3 h-3 text-success-fg" />
                      <span className="text-success-fg">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
