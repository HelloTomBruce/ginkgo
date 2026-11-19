"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Puzzle,
  Plus,
  Trash2,
  Pencil,
  Power,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Sliders,
  Wrench,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "@/lib/toast";
import type { StoredMcpServer } from "@/lib/mcpStore";
import { useHarnessSettings } from "@/hooks/useHarnessSettings";

interface ServerStatusItem extends StoredMcpServer {
  status?: {
    serverId: string;
    connected: boolean;
    transport: "stdio" | "sse" | "streamable_http";
    toolCount: number;
    error?: string;
  };
}

interface FormState {
  mode: "create" | "edit";
  id: string;
  name: string;
  transport: "sse" | "stdio";
  url: string;
  headersJson: string;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  timeoutSeconds: number;
  allowedToolsText: string;
}

const INITIAL_FORM: FormState = {
  mode: "create",
  id: "",
  name: "",
  transport: "sse",
  url: "",
  headersJson: "",
  command: "npx",
  argsText: "",
  envText: "",
  cwd: "",
  timeoutSeconds: 30,
  allowedToolsText: "",
};

export function McpSettings() {
  const [servers, setServers] = useState<ServerStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [probingServerId, setProbingServerId] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<{
    serverId: string;
    ok: boolean;
    latencyMs: number;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
  } | null>(null);
  const [formProbing, setFormProbing] = useState(false);
  const [formProbeResult, setFormProbeResult] = useState<{
    ok: boolean;
    latencyMs: number;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
  } | null>(null);

  const { settings, updateMcpRuntime } = useHarnessSettings();
  const [runtimeExpanded, setRuntimeExpanded] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp");
      if (!res.ok) throw new Error("获取 MCP 服务器列表失败");
      const data = await res.json();
      setServers(data.servers || []);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "获取 MCP 服务失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/mcp")
      .then((res) => {
        if (!res.ok) throw new Error("获取 MCP 服务器列表失败");
        return res.json();
      })
      .then((data) => {
        if (active) setServers(data.servers || []);
      })
      .catch((err) => {
        if (active) {
          console.error(err);
          toast.error(err instanceof Error ? err.message : "获取 MCP 服务失败");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchServers();
  };

  const handleToggleEnable = async (server: ServerStatusItem) => {
    const updated = {
      ...server,
      enabled: server.enabled === false ? true : false,
    };
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("更新状态失败");
      await fetchServers();
      toast.success(
        updated.enabled ? `已启用 ${server.name || server.id}` : `已停用 ${server.name || server.id}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新状态失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要移除 MCP 服务器「${id}」吗？`)) return;
    try {
      const res = await fetch(`/api/mcp?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除失败");
      await fetchServers();
      toast.success("已移除 MCP 服务器");
      if (probeResult?.serverId === id) {
        setProbeResult(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleOpenCreate = () => {
    setForm(INITIAL_FORM);
    setFormProbeResult(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (server: ServerStatusItem) => {
    let argsText = "";
    let envText = "";
    if (server.transport === "stdio") {
      argsText = (server.args || []).join(" ");
      envText = server.env
        ? Object.entries(server.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : "";
    }

    const headersJson =
      server.headers && Object.keys(server.headers).length > 0
        ? JSON.stringify(server.headers, null, 2)
        : "";

    setForm({
      mode: "edit",
      id: server.id,
      name: server.name || server.id,
      transport: server.transport === "stdio" ? "stdio" : "sse",
      url: server.transport !== "stdio" ? server.url || "" : "",
      headersJson,
      command: server.transport === "stdio" ? server.command || "npx" : "npx",
      argsText,
      envText,
      cwd: server.cwd || "",
      timeoutSeconds: server.timeoutMs ? Math.round(server.timeoutMs / 1000) : 30,
      allowedToolsText: (server.allowedTools || []).join(", "),
    });
    setFormProbeResult(null);
    setFormOpen(true);
  };

  const buildServerConfigFromForm = (): StoredMcpServer => {
    const base: StoredMcpServer = {
      id: form.id.trim(),
      name: form.name.trim() || form.id.trim(),
      transport: form.transport,
      timeoutMs: form.timeoutSeconds * 1000,
      allowedTools: form.allowedToolsText
        ? form.allowedToolsText.split(/[,，\s]+/).filter(Boolean)
        : undefined,
    };

    if (form.transport === "stdio") {
      const parsedEnv: Record<string, string> = {};
      form.envText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const eqIdx = line.indexOf("=");
          const colonIdx = line.indexOf(":");
          const idx = eqIdx > 0 ? eqIdx : colonIdx;
          if (idx > 0) {
            const k = line.slice(0, idx).trim();
            const v = line.slice(idx + 1).trim();
            if (k) parsedEnv[k] = v;
          }
        });

      base.command = form.command.trim();
      base.args = form.argsText.split(/\s+/).filter(Boolean);
      base.env = Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined;
      base.cwd = form.cwd.trim() || undefined;
    } else {
      base.url = form.url.trim();
      if (form.headersJson.trim()) {
        try {
          const parsed = JSON.parse(form.headersJson.trim());
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("Headers 必须为 JSON 对象格式，如 {\"Authorization\": \"Bearer ...\"}");
          }
          const parsedHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            parsedHeaders[k] = String(v);
          }
          base.headers = parsedHeaders;
        } catch (err) {
          throw new Error(
            `Headers JSON 解析失败: ${err instanceof Error ? err.message : "格式不合法"}`
          );
        }
      }
    }

    return base;
  };

  const handleFormProbe = async () => {
    let config: StoredMcpServer;
    try {
      config = buildServerConfigFromForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "配置校验失败");
      return;
    }

    if (!config.id) {
      toast.error("请先填写服务 ID");
      return;
    }
    if (config.transport === "sse" && !config.url) {
      toast.error("请先填写 Endpoint URL");
      return;
    }
    if (config.transport === "stdio" && !config.command) {
      toast.error("请先填写执行命令 Command");
      return;
    }

    setFormProbing(true);
    setFormProbeResult(null);
    try {
      const res = await fetch("/api/mcp/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setFormProbeResult(data);
      if (data.ok) {
        toast.success(`连接测试成功（${data.latencyMs}ms），扫描到 ${data.tools?.length || 0} 个工具`);
      } else {
        toast.error(`连接测试失败: ${data.error || "未知异常"}`);
      }
    } catch (err) {
      setFormProbeResult({
        ok: false,
        latencyMs: 0,
        tools: [],
        error: err instanceof Error ? err.message : "请求失败",
      });
      toast.error("探活请求异常");
    } finally {
      setFormProbing(false);
    }
  };

  const handleSaveForm = async () => {
    let config: StoredMcpServer;
    try {
      config = buildServerConfigFromForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "配置校验失败");
      return;
    }

    if (!config.id) {
      toast.error("请输入 MCP 服务器 ID");
      return;
    }
    if (config.transport === "sse" && !config.url) {
      toast.error("请输入 SSE Endpoint URL");
      return;
    }
    if (config.transport === "stdio" && !config.command) {
      toast.error("请输入 Stdio 启动命令");
      return;
    }

    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      toast.success("MCP 服务器配置已保存");
      setFormOpen(false);
      await fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存配置失败");
    }
  };

  const handleProbeExisting = async (server: ServerStatusItem) => {
    setProbingServerId(server.id);
    try {
      const res = await fetch("/api/mcp/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(server),
      });
      const data = await res.json();
      setProbeResult({
        serverId: server.id,
        ...data,
      });
      if (data.ok) {
        toast.success(`「${server.name || server.id}」连通成功（${data.latencyMs}ms）`);
      } else {
        toast.error(`「${server.name || server.id}」探活失败: ${data.error}`);
      }
    } catch {
      toast.error("探活网络请求失败");
    } finally {
      setProbingServerId(null);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* 头部与操作区 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
            <Puzzle className="w-4 h-4 text-brand-fg" />
            <span>MCP 工具扩展（Model Context Protocol）</span>
          </h3>
          <p className="text-[11px] text-foreground-subtle mt-0.5">
            注册本地进程或远程 SSE 工具服务，赋予大模型文件读写、代码平台协同与系统自动化能力。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="p-1.5 rounded-lg border border-border text-foreground-subtle hover:bg-muted cursor-pointer"
            title="刷新服务状态"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-info-solid text-info-on-solid hover:bg-info-solid-hover font-medium cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>注册 MCP 服务</span>
          </button>
        </div>
      </div>

      {/* 运行时参数折叠区 */}
      <Collapsible
        open={runtimeExpanded}
        onOpenChange={setRuntimeExpanded}
        className="rounded-xl border border-border bg-card p-3"
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full text-left font-medium text-foreground cursor-pointer">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-info-fg" />
            <span>MCP 客户端运行时参数（连接池与超时）</span>
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-foreground-faint transition-transform ${
              runtimeExpanded ? "rotate-180" : ""
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 mt-2 border-t border-border-subtle grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              调用超时上限（秒）
            </label>
            <input
              type="number"
              min="5"
              max="300"
              value={settings.mcpRuntime.defaultTimeoutSeconds}
              onChange={(e) =>
                updateMcpRuntime({ defaultTimeoutSeconds: Number(e.target.value) || 30 })
              }
              className="w-full p-2 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              客户端连接池容量
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={settings.mcpRuntime.maxPoolSize}
              onChange={(e) =>
                updateMcpRuntime({ maxPoolSize: Number(e.target.value) || 5 })
              }
              className="w-full p-2 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              异常掉线重试次数
            </label>
            <input
              type="number"
              min="0"
              max="5"
              value={settings.mcpRuntime.maxReconnectRetries}
              onChange={(e) =>
                updateMcpRuntime({ maxReconnectRetries: Number(e.target.value) || 3 })
              }
              className="w-full p-2 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* 服务器列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-info-fg" />
          <span>正在加载 MCP 服务配置...</span>
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-8 text-center bg-surface-sunken">
          <Puzzle className="w-8 h-8 text-foreground-faint mx-auto mb-2" />
          <p className="font-medium text-foreground mb-1">暂未配置任何 MCP 服务器</p>
          <p className="text-foreground-subtle text-[11px] max-w-sm mx-auto mb-4">
            MCP（Model Context Protocol）是大模型与外部系统的开放互联标准。您可以注册 GitHub、GitLab、ZenTao 或本地数据库/文件系统工具。
          </p>
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info-solid text-info-on-solid hover:bg-info-solid-hover text-xs font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>立即注册第一个 MCP 服务</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {servers.map((server) => {
            const isEnabled = server.enabled !== false;
            const isProbing = probingServerId === server.id;
            const hasProbeResult = probeResult?.serverId === server.id;

            return (
              <div
                key={server.id}
                className={`rounded-xl border transition-all ${
                  isEnabled
                    ? "border-border bg-card shadow-xs"
                    : "border-border-subtle bg-surface-sunken opacity-75"
                } p-3.5`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground text-sm">
                        {server.name || server.id}
                      </span>
                      <span className="font-mono text-[11px] text-foreground-faint">
                        ({server.id})
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                          server.transport === "stdio"
                            ? "bg-brand-soft-strong text-brand-fg-strong"
                            : "bg-sky-soft-strong text-sky-fg-strong"
                        }`}
                      >
                        {server.transport === "stdio" ? "Stdio 进程" : "SSE / HTTP"}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isEnabled
                            ? "bg-success-soft text-success-fg"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isEnabled ? "bg-success-solid" : "bg-foreground-faint"
                          }`}
                        />
                        {isEnabled ? "已启用" : "已停用"}
                      </span>
                    </div>

                    <div className="text-[11px] text-foreground-subtle font-mono truncate">
                      {server.transport === "stdio" ? (
                        <span>
                          {server.command} {(server.args || []).join(" ")}
                        </span>
                      ) : (
                        <span>{server.url}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleProbeExisting(server)}
                      disabled={isProbing}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-[11px] hover:bg-muted text-foreground-subtle cursor-pointer transition-colors"
                      title="探活连接并发现可用 Tools"
                    >
                      {isProbing ? (
                        <Loader2 className="w-3 h-3 animate-spin text-info-fg" />
                      ) : (
                        <Wrench className="w-3 h-3 text-info-fg" />
                      )}
                      <span>测试探活</span>
                    </button>
                    <button
                      onClick={() => handleToggleEnable(server)}
                      className={`p-1.5 rounded-lg border border-border cursor-pointer transition-colors ${
                        isEnabled
                          ? "text-success-fg hover:bg-success-soft"
                          : "text-foreground-faint hover:bg-muted"
                      }`}
                      title={isEnabled ? "停用该服务" : "启用该服务"}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleOpenEdit(server)}
                      className="p-1.5 rounded-lg border border-border text-foreground-subtle hover:bg-muted cursor-pointer"
                      title="编辑配置"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(server.id)}
                      className="p-1.5 rounded-lg border border-border text-danger-fg hover:bg-danger-soft cursor-pointer"
                      title="删除服务"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 探活结果卡片 */}
                {hasProbeResult && (
                  <div className="mt-3 pt-3 border-t border-border-subtle">
                    {probeResult.ok ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1 text-success-fg font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            连通正常（耗时 {probeResult.latencyMs}ms）
                          </span>
                          <span className="text-foreground-faint">
                            扫描到 {probeResult.tools.length} 个工具
                          </span>
                        </div>
                        {probeResult.tools.length > 0 && (
                          <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 rounded-lg bg-surface-sunken border border-border-subtle">
                            {probeResult.tools.map((t) => (
                              <div
                                key={t.name}
                                className="flex items-start justify-between gap-2"
                              >
                                <span className="font-mono text-xs text-info-fg font-medium">
                                  {t.name}
                                </span>
                                <span className="text-[11px] text-foreground-faint truncate max-w-xs">
                                  {t.description || "无描述"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-danger-soft border border-danger-border flex items-start gap-2 text-danger-fg text-[11px]">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">探活失败</p>
                          <p className="font-mono text-[10px] mt-0.5 text-danger-fg-strong">
                            {probeResult.error}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 注册 / 编辑弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl lg:max-w-3xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Puzzle className="w-4 h-4 text-brand-fg" />
              <span>
                {form.mode === "create" ? "注册 MCP 服务器" : `编辑 MCP: ${form.name || form.id}`}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1 text-xs max-h-[75vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  服务唯一标识 ID *
                </label>
                <input
                  type="text"
                  value={form.id}
                  disabled={form.mode === "edit"}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="如: github-mcp"
                  className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  显示名称
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如: GitHub 代码管理"
                  className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken text-xs"
                />
              </div>
            </div>

            {/* 传输协议单选 */}
            <fieldset>
              <legend className="block text-muted-foreground mb-1 font-medium">
                传输协议类型
              </legend>
              <RadioGroup
                value={form.transport}
                onValueChange={(v) => setForm({ ...form, transport: v as "sse" | "stdio" })}
                className="grid grid-cols-2 gap-3"
              >
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="sse" />
                  <div>
                    <div className="font-medium text-foreground">SSE / Streamable HTTP</div>
                    <div className="text-[10px] text-foreground-faint">远程微服务或容器网关</div>
                  </div>
                </label>
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="stdio" />
                  <div>
                    <div className="font-medium text-foreground">Stdio 本地进程</div>
                    <div className="text-[10px] text-foreground-faint">npx / uvx / docker 启动</div>
                  </div>
                </label>
              </RadioGroup>
            </fieldset>

            {/* SSE 字段 */}
            {form.transport === "sse" ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-muted-foreground mb-1 font-medium">
                    SSE Endpoint URL *
                  </label>
                  <input
                    type="text"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="http://localhost:8080/sse 或 https://mcp.internal/v1"
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="mcp-headers-json"
                      className="block text-muted-foreground font-medium"
                    >
                      HTTP 请求头 Headers（JSON 格式，可选）
                    </label>
                    <div className="flex items-center gap-2">
                      {form.headersJson.trim() && (
                        <span
                          className={`text-[10px] font-mono ${
                            (() => {
                              try {
                                const p = JSON.parse(form.headersJson);
                                return typeof p === "object" && p !== null && !Array.isArray(p)
                                  ? "text-success-fg"
                                  : "text-danger-fg";
                              } catch {
                                return "text-danger-fg";
                              }
                            })()
                          }`}
                        >
                          {(() => {
                            try {
                              const p = JSON.parse(form.headersJson);
                              if (typeof p === "object" && p !== null && !Array.isArray(p)) {
                                return `✓ JSON 有效（${Object.keys(p).length} 项）`;
                              }
                              return "✗ 必须为 JSON 对象结构";
                            } catch {
                              return "✗ JSON 语法错误";
                            }
                          })()}
                        </span>
                      )}
                      {form.headersJson.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              const p = JSON.parse(form.headersJson);
                              setForm({ ...form, headersJson: JSON.stringify(p, null, 2) });
                            } catch {
                              toast.error("JSON 格式错误，无法美化");
                            }
                          }}
                          className="text-[10px] text-info-fg hover:underline cursor-pointer"
                        >
                          美化格式
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    id="mcp-headers-json"
                    rows={4}
                    value={form.headersJson}
                    onChange={(e) => setForm({ ...form, headersJson: e.target.value })}
                    placeholder={`{\n  "Authorization": "Bearer <your-token>",\n  "X-API-Key": "secret-key"\n}`}
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs leading-relaxed"
                  />
                  <p className="text-[10px] text-foreground-faint mt-1">
                    使用标准 JSON 键值对格式传递认证令牌（如 Bearer Token）或网关路由头。
                  </p>
                </div>
              </div>
            ) : (
              /* Stdio 字段 */
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="block text-muted-foreground mb-1 font-medium">
                      启动命令 Command *
                    </label>
                    <input
                      type="text"
                      value={form.command}
                      onChange={(e) => setForm({ ...form, command: e.target.value })}
                      placeholder="npx / uvx / docker / python"
                      className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-muted-foreground mb-1 font-medium">
                      命令参数 Args（空格分隔）
                    </label>
                    <input
                      type="text"
                      value={form.argsText}
                      onChange={(e) => setForm({ ...form, argsText: e.target.value })}
                      placeholder="-y @modelcontextprotocol/server-postgres postgresql://..."
                      className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1 font-medium">
                    工作目录 CWD（可选，执行命令的工作路径）
                  </label>
                  <input
                    type="text"
                    value={form.cwd}
                    onChange={(e) => setForm({ ...form, cwd: e.target.value })}
                    placeholder="留空默认使用应用当前根目录"
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1 font-medium flex items-center justify-between">
                    <span>环境变量注入 Environment Variables（每行 KEY=VALUE）</span>
                    <span className="font-mono text-foreground-faint text-[10px]">
                      {form.envText.split("\n").filter((l) => l.includes("=")).length} 项已输入
                    </span>
                  </label>
                  <textarea
                    rows={3}
                    value={form.envText}
                    onChange={(e) => setForm({ ...form, envText: e.target.value })}
                    placeholder={"GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxx\nAPI_HOST=127.0.0.1\nDATABASE_URL=postgresql://..."}
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs leading-relaxed"
                  />
                  <p className="text-[10px] text-foreground-faint mt-1">
                    启动 Stdio 进程时将环境变量注入子进程中，用于传递 API 凭证或连接串。
                  </p>
                </div>
              </div>
            )}

            {/* 高级选项 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  单次工具超时（秒）
                </label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={form.timeoutSeconds}
                  onChange={(e) =>
                    setForm({ ...form, timeoutSeconds: Number(e.target.value) || 30 })
                  }
                  className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  工具白名单过滤（逗号分隔，留空全选）
                </label>
                <input
                  type="text"
                  value={form.allowedToolsText}
                  onChange={(e) => setForm({ ...form, allowedToolsText: e.target.value })}
                  placeholder="如: read_file, list_directory"
                  className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                />
              </div>
            </div>

            {/* 弹窗内探活与测试 */}
            <div className="pt-2 border-t border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground">
                  保存前可先探活验证服务连通性
                </span>
                <button
                  type="button"
                  onClick={handleFormProbe}
                  disabled={formProbing}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg border border-border bg-card hover:bg-muted text-xs font-medium cursor-pointer"
                >
                  {formProbing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-info-fg" />
                  ) : (
                    <Wrench className="w-3.5 h-3.5 text-info-fg" />
                  )}
                  <span>测试连接与扫描工具</span>
                </button>
              </div>

              {formProbeResult && (
                <div className="mt-2">
                  {formProbeResult.ok ? (
                    <div className="p-2.5 rounded-lg bg-success-soft border border-success-border text-success-fg text-[11px] space-y-1">
                      <div className="flex items-center justify-between font-medium">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          连接成功（耗时 {formProbeResult.latencyMs}ms）
                        </span>
                        <span>发现 {formProbeResult.tools.length} 个可用 Tools</span>
                      </div>
                      {formProbeResult.tools.length > 0 && (
                        <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[10px] text-success-fg-strong">
                          {formProbeResult.tools.map((t) => (
                            <div key={t.name}>• {t.name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-danger-soft border border-danger-border text-danger-fg text-[11px] flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">连接探活失败</p>
                        <p className="font-mono text-[10px] text-danger-fg-strong">
                          {formProbeResult.error}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveForm}
              className="px-4 py-1.5 rounded-lg bg-info-solid text-info-on-solid hover:bg-info-solid-hover text-xs font-medium cursor-pointer"
            >
              保存配置
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
