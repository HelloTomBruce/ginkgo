"use client";

import React, { useRef, useState } from "react";
import {
  Database,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  Upload,
} from "lucide-react";
import { Hint } from "@/components/ui/hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DataSourceDescriptor } from "@ginkgolab/datasources";
import { authHeaders } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useDatasources } from "./useDatasources";
import { FileSourcePanel } from "./FileSourcePanel";
import { SchemaCardStatus } from "./SchemaCardStatus";

type SourceKind = "db" | "file";

interface FormState {
  mode: "create" | "edit";
  id: string;
  name: string;
  kind: SourceKind;
  dbType: "postgres" | "mysql" | "sqlite" | "clickhouse";
  connectionString: string;
  connPreview: string;
}

const CLOSED_FORM: null = null;

const DB_CONNECTION_PLACEHOLDERS: Record<FormState["dbType"], string> = {
  postgres: "postgresql://user:pass@host:5432/db",
  mysql: "mysql://user:pass@host:3306/db",
  sqlite: "/path/to/database.sqlite 或 ./data/app.db",
  clickhouse: "http://default:pass@host:8123/default",
};

function kindBadge(source: DataSourceDescriptor): string {
  if (source.kind === "file") return "文件";
  if (source.kind === "db") {
    if (source.dbType === "mysql") return "MySQL";
    if (source.dbType === "sqlite") return "SQLite";
    if (source.dbType === "clickhouse") return "ClickHouse";
    return "PostgreSQL";
  }
  return "数据库";
}

function badgeClass(source: DataSourceDescriptor): string {
  if (source.kind === "db") {
    return "bg-sky-soft-strong text-sky-fg-strong";
  }
  return "bg-warning-soft-strong text-warning-fg-strong";
}

export function DatasourceSettings() {
  const { sources, health, loading, refreshing, createSource, updateSource, removeSource } =
    useDatasources();
  const [form, setForm] = useState<FormState | typeof CLOSED_FORM>(CLOSED_FORM);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** 行内操作 pending：启停/删除涉及 PATCH/DELETE，秒级耗时必须有反馈 */
  const [pending, setPending] = useState<{
    id: string;
    action: "toggle" | "delete";
  } | null>(null);

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files]);
    if (files.length > 0 && form) {
      const first = files[0];
      const baseName = first.name.replace(/\.[^/.]+$/, "");
      const safeId = baseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setForm((curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          name: curr.name || baseName,
          id: curr.id || (safeId ? `file-${safeId}` : `file-${Date.now().toString(36)}`),
        };
      });
    }
  };

  const openCreate = () => {
    setErrors([]);
    setSelectedFiles([]);
    setDragOver(false);
    setForm({
      mode: "create",
      id: "",
      name: "",
      kind: "db",
      dbType: "postgres",
      connectionString: "",
      connPreview: "",
    });
  };

  const openEdit = (s: DataSourceDescriptor) => {
    setErrors([]);
    const maskedConn = s.kind === "db" ? (s.maskedConnectionString ?? "") : "";
    setForm({
      mode: "edit",
      id: s.id,
      name: s.name,
      kind: s.kind,
      dbType: s.dbType ?? "postgres",
      // db 连接串支持回显已配置的连接串（含脱敏串），方便查看与编辑
      connectionString: maskedConn,
      connPreview: maskedConn,
    });
  };

  const closeForm = () => {
    setForm(CLOSED_FORM);
    setErrors([]);
    setSelectedFiles([]);
    setDragOver(false);
    setSaving(false);
  };

  const submit = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      if (form.mode === "create") {
        const body: Record<string, unknown> = {
          id: form.id.trim(),
          name: form.name.trim(),
          kind: form.kind,
        };
        if (form.kind === "db") {
          body.dbType = form.dbType;
          body.connectionString = form.connectionString.trim();
        }
        // file：若选择了文件，创建完成后立即上传
        const result = await createSource(body);
        if (result.ok) {
          if (form.kind === "file" && selectedFiles.length > 0) {
            try {
              const formData = new FormData();
              for (const f of selectedFiles) formData.append("files", f);
              const uploadRes = await fetch(`/api/datasources/${body.id}/file`, {
                method: "POST",
                headers: { ...authHeaders() },
                body: formData,
              });
              if (!uploadRes.ok) {
                const errBody = (await uploadRes.json().catch(() => null)) as {
                  error?: string;
                } | null;
                setErrors([
                  errBody?.error ?? "数据源已创建，但文件解析上传失败，请在列表中重试",
                ]);
                setSaving(false);
                return;
              }
            } catch (err) {
              setErrors([err instanceof Error ? err.message : "文件上传失败"]);
              setSaving(false);
              return;
            }
          }
          closeForm();
        } else {
          setErrors(result.errors ?? ["创建失败"]);
        }
        return;
      }

      // 编辑模式：
      // - db: 若连接串未修改（仍等于初始回显值）或留空，则不提交 connectionString，保留服务端凭证；若修改且含 *** 则拦截
      const patch: Record<string, unknown> = { name: form.name.trim() };
      if (form.kind === "db") {
        patch.dbType = form.dbType;
        const conn = form.connectionString.trim();
        const originalConn = form.connPreview.trim();
        if (conn && conn !== originalConn) {
          if (conn.includes("***")) {
            setErrors(["连接串包含脱敏星号(***)，若修改连接串请填入完整密码"]);
            return;
          }
          patch.connectionString = conn;
        }
      }

      const result = await updateSource(form.id, patch);
      if (result.ok) closeForm();
      else setErrors(result.errors ?? ["更新失败"]);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (s: DataSourceDescriptor) => {
    setPending({ id: s.id, action: "toggle" });
    try {
      await updateSource(s.id, { enabled: !(s.enabled !== false) });
    } finally {
      setPending(null);
    }
  };

  const remove = async (id: string) => {
    setPending({ id, action: "delete" });
    try {
      await removeSource(id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "删除数据源失败", "error");
    } finally {
      setPending(null);
    }
  };

  const inputClass =
    "w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs focus:outline-none focus:ring-1 focus:ring-border-strong";
  const labelClass = "block text-muted-foreground mb-1 font-medium text-xs";

  return (
    <div className="space-y-4 text-xs">
      {/* 源列表 */}
      <div className="space-y-2">
        {loading && sources.length === 0 && (
          <div className="text-[11px] text-foreground-faint">加载中...</div>
        )}
        {refreshing && sources.length > 0 && (
          <div className="text-[10px] text-foreground-faint flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>正在检查数据源健康状态…</span>
          </div>
        )}
        {sources.map((s) => {
          const h = health[s.id];
          const enabled = s.enabled !== false;
          const busy = pending?.id === s.id;
          const busyToggle = busy && pending.action === "toggle";
          const busyDelete = busy && pending.action === "delete";
          return (
            <div
              key={s.id}
              className="border border-border rounded-lg px-3 py-2 space-y-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    h === undefined
                      ? "bg-surface-raised"
                      : h.ok
                        ? "bg-success-solid"
                        : "bg-danger-solid"
                  }`}
                  title={h?.error || ""}
                />
                <span className="flex-1 truncate text-foreground-subtle">
                  {s.name}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 ${badgeClass(s)}`}
                >
                  {kindBadge(s)}
                </span>
                <span className="text-foreground-faint font-mono text-[10px] shrink-0">
                  {h === undefined ? "..." : h.ok ? `${h.latencyMs}ms` : "异常"}
                </span>
                <button
                  type="button"
                  onClick={() => void toggleEnabled(s)}
                  disabled={busy}
                  aria-busy={busyToggle}
                  aria-label={`启停 ${s.id}`}
                  title={enabled ? "点击停用" : "点击启用"}
                  className={`p-1 rounded transition-colors ${
                    enabled
                      ? "text-success-fg hover:bg-muted"
                      : "text-foreground-faint hover:bg-muted"
                  }`}
                >
                  {busyToggle ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                </button>
                <Hint label="编辑">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    disabled={busy}
                    aria-label={`编辑 ${s.id}`}
                    className="p-1 rounded text-foreground-faint hover:text-foreground-subtle hover:bg-muted disabled:opacity-50"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Hint>
                <Hint label="删除">
                  <button
                    type="button"
                    onClick={() => void remove(s.id)}
                    disabled={busy}
                    aria-busy={busyDelete}
                    aria-label={`删除 ${s.id}`}
                    className="p-1 rounded text-foreground-faint hover:text-danger-fg hover:bg-muted disabled:opacity-50"
                  >
                    {busyDelete ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </Hint>
              </div>

              {s.kind === "file" && <FileSourcePanel sourceId={s.id} />}
              <SchemaCardStatus sourceId={s.id} />
            </div>
          );
        })}
      </div>

      {/* 添加按钮 */}
      <button
        type="button"
        onClick={openCreate}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border-strong text-muted-foreground hover:bg-surface-sunken transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>添加数据源</span>
      </button>

      {/* 弹窗编辑 / 创建表单 */}
      {form && (
        <Dialog open onOpenChange={(open) => !open && closeForm()}>
          <DialogContent
            className="max-w-lg sm:max-w-lg p-5 flex flex-col gap-4 overflow-hidden z-[60]"
            overlayClassName="z-[60] bg-black/40 backdrop-blur-xs"
          >
            <DialogHeader>
              <DialogTitle className="font-bold text-sm text-foreground">
                {form.mode === "create" ? "添加数据源" : `编辑数据源（${form.name || form.id}）`}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {form.mode === "create" ? "配置并添加新的数据源" : "修改现有数据源配置"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 max-h-[60vh] overflow-y-auto pr-1 text-xs">
              {form.mode === "create" && (
                <div className="grid grid-cols-2 gap-2">
                  <label
                    htmlFor="ds-kind-db"
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-surface-sunken cursor-pointer hover:border-border-strong transition-colors"
                  >
                    <input
                      id="ds-kind-db"
                      type="radio"
                      name="ds-kind"
                      checked={form.kind === "db"}
                      onChange={() => setForm({ ...form, kind: "db" })}
                    />
                    <span className="font-medium text-foreground-subtle">数据库连接</span>
                  </label>
                  <label
                    htmlFor="ds-kind-file"
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-surface-sunken cursor-pointer hover:border-border-strong transition-colors"
                  >
                    <input
                      id="ds-kind-file"
                      type="radio"
                      name="ds-kind"
                      checked={form.kind === "file"}
                      onChange={() => setForm({ ...form, kind: "file" })}
                    />
                    <span className="font-medium text-foreground-subtle">文件（CSV/Excel/Parquet/JSON）</span>
                  </label>
                </div>
              )}

              {form.mode === "create" && (
                <div>
                  <label htmlFor="ds-id" className={labelClass}>
                    ID（小写字母开头，仅小写字母/数字/连字符）
                  </label>
                  <input
                    id="ds-id"
                    type="text"
                    value={form.id}
                    onChange={(e) => setForm({ ...form, id: e.target.value })}
                    placeholder="mysql-orders / crm-db"
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <label htmlFor="ds-name" className={labelClass}>
                  名称
                </label>
                <input
                  id="ds-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="订单库 / 销售表"
                  className={inputClass}
                />
              </div>

              {form.kind === "db" && (
                <>
                  <div>
                    <label htmlFor="ds-dbtype" className={labelClass}>
                      数据库类型
                    </label>
                    <select
                      id="ds-dbtype"
                      name="ds-dbtype"
                      value={form.dbType}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          dbType: e.target.value as FormState["dbType"],
                        })
                      }
                      className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-border-strong cursor-pointer"
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                      <option value="sqlite">SQLite（文件路径）</option>
                      <option value="clickhouse">ClickHouse</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ds-conn" className={labelClass}>
                      {form.dbType === "sqlite"
                        ? "连接串 / 数据库路径（本地 SQLite 文件，强制只读查询）"
                        : "连接串（URL 形式，强制只读查询）"}
                    </label>
                    <input
                      id="ds-conn"
                      type="password"
                      autoComplete="off"
                      value={form.connectionString}
                      onChange={(e) =>
                        setForm({ ...form, connectionString: e.target.value })
                      }
                      placeholder={
                        form.mode === "edit" && form.connPreview
                          ? `${form.connPreview}（留空保持不变）`
                          : DB_CONNECTION_PLACEHOLDERS[form.dbType] || "postgresql://user:pass@host:5432/db"
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="text-[11px] text-foreground-faint flex items-center gap-1.5 pt-0.5">
                    <Database className="w-3.5 h-3.5 shrink-0" />
                    <span>数据库源仅允许只读 SELECT，自动行数封顶与超时保护</span>
                  </div>
                </>
              )}

              {form.kind === "file" && (
                <div className="space-y-3">
                  {form.mode === "edit" ? (
                    <div className="border border-border rounded-lg p-3 bg-surface-sunken space-y-2">
                      <div className="text-xs font-medium text-foreground">文件数据与表格管理</div>
                      <FileSourcePanel sourceId={form.id} />
                    </div>
                  ) : (
                    <div>
                      <div className={labelClass}>
                        选择数据表格文件（支持 CSV / Excel / Parquet / JSON）
                      </div>
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOver(false);
                          if (e.dataTransfer.files?.length) {
                            handleFilesSelected(Array.from(e.dataTransfer.files));
                          }
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                          dragOver
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-border-strong bg-surface-sunken"
                        }`}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".csv,.tsv,.xlsx,.xls,.parquet,.json"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.length) {
                              handleFilesSelected(Array.from(e.target.files));
                            }
                          }}
                        />
                        <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                          <Upload className="w-5 h-5 text-foreground-faint" />
                          <span className="text-xs font-medium text-foreground">
                            点击选择文件 或 拖拽文件到此处
                          </span>
                          <span className="text-[11px] text-foreground-faint">
                            支持 .csv、.xlsx、.xls、.parquet、.json（可多选，单个 ≤50MB）
                          </span>
                        </div>
                      </div>

                      {selectedFiles.length > 0 && (
                        <div className="mt-2.5 space-y-1.5">
                          <div className="text-[11px] font-medium text-foreground-subtle">
                            已选择待上传文件 ({selectedFiles.length})：
                          </div>
                          <div className="max-h-28 overflow-y-auto space-y-1">
                            {selectedFiles.map((file, idx) => (
                              <div
                                key={`${file.name}-${idx}`}
                                className="flex items-center justify-between p-2 rounded bg-card border border-border text-[11px]"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <FileSpreadsheet className="w-3.5 h-3.5 text-success-fg shrink-0" />
                                  <span className="truncate text-foreground">{file.name}</span>
                                  <span className="text-foreground-faint shrink-0">
                                    ({(file.size / 1024).toFixed(1)} KB)
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFiles((prev) =>
                                      prev.filter((_, i) => i !== idx)
                                    );
                                  }}
                                  className="text-foreground-faint hover:text-danger-fg ml-2 shrink-0 p-0.5"
                                  title="移除"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="text-[11px] text-foreground-faint flex items-center gap-1.5 pt-1.5">
                        <Database className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          文件将由内置 DuckDB 引擎解析为关系型库表，支持高速只读 SQL 与对话分析
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {errors.length > 0 && (
                <div className="text-[11px] text-danger-fg space-y-1 p-2 rounded-lg bg-danger-soft border border-danger-border">
                  {errors.map((e) => (
                    <div key={e}>· {e}</div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={closeForm}
                className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-info-solid text-white text-xs font-medium hover:bg-info-solid-hover shadow-xs disabled:opacity-50 flex items-center gap-1"
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>保存</span>
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
