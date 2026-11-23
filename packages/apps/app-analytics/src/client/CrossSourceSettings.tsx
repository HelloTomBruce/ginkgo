"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { AppSettingsSectionProps } from "@ginkgo/app-sdk";
import { Hint } from "./ui/hint";

/** 查看契约：GET /api/cross-source 的 mappings 项（见 server/crossSourceRoutes） */
interface MappingView {
  projectSource: string;
  project: string;
  projectName?: string;
  repoSource: string;
  repo: string;
}

interface SourceView {
  id: string;
  name: string;
  enabled: boolean;
}

interface CrossSourcePayload {
  mappings: MappingView[];
  sources: SourceView[];
  /** 跨源联合分析当前是否成立（服务端按「映射存在且双侧源启用」判定，客户端不自行推断） */
  active: boolean;
}

/** 取数结果：字符串 = 错误消息 */
type LoadResult = CrossSourcePayload | string;

type SaveResult =
  | { ok: true; data: CrossSourcePayload }
  | { ok: false; errors: string[] };

function isPayload(value: unknown): value is CrossSourcePayload {
  if (!value || typeof value !== "object") return false;
  const o = value as Partial<CrossSourcePayload>;
  return (
    Array.isArray(o.mappings) &&
    Array.isArray(o.sources) &&
    typeof o.active === "boolean"
  );
}

function extractErrors(status: number, body: unknown): string[] {
  if (body && typeof body === "object") {
    const o = body as { errors?: unknown; error?: unknown };
    if (Array.isArray(o.errors) && o.errors.length > 0) {
      return o.errors.map(String);
    }
    if (typeof o.error === "string" && o.error) return [o.error];
  }
  return [`HTTP ${status}`];
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 模块级函数：setState 只发生在调用方的 then 回调 */
async function fetchCrossSource(
  request: AppSettingsSectionProps["request"]
): Promise<LoadResult> {
  try {
    const res = await request("/api/cross-source");
    if (!res.ok) return `HTTP ${res.status}`;
    const body: unknown = await readJson(res);
    return isPayload(body) ? body : "响应格式不正确";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** 整份替换映射清单；校验失败时带回服务端的逐条 errors */
async function putCrossSource(
  request: AppSettingsSectionProps["request"],
  mappings: MappingView[]
): Promise<SaveResult> {
  try {
    const res = await request("/api/cross-source", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings }),
    });
    const body: unknown = await readJson(res);
    if (res.ok && isPayload(body)) return { ok: true, data: body };
    return { ok: false, errors: extractErrors(res.status, body) };
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

interface FormState {
  /** 编辑中的映射下标；null = 新增 */
  index: number | null;
  projectSource: string;
  project: string;
  projectName: string;
  repoSource: string;
  repo: string;
}

const CLOSED_FORM: null = null;

/**
 * 设置中心「跨源映射」分区（client.settingsSections 插槽）：项目管理侧项目 ↔ 代码仓库侧
 * 仓库的对应关系。增/改/删均提交全量清单到 PUT /api/cross-source，即时保存；
 * 能力是否开启直接展示服务端判定的 active。
 */
export function CrossSourceSettings({ request }: AppSettingsSectionProps) {
  const [data, setData] = useState<CrossSourcePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 取数/保存进行中：按钮置灰并给出反馈 */
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | typeof CLOSED_FORM>(CLOSED_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  /** 删除走行内二次确认：映射是用户手工建立的数据，误删成本高 */
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null);
  const baseId = useId();

  // request 经 ref 供挂载取数使用：宿主若传入非稳定引用，不会让取数 effect 反复重跑
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const applyLoad = useCallback((result: LoadResult) => {
    if (typeof result === "string") setLoadError(result);
    else {
      setData(result);
      setLoadError(null);
    }
    setBusy(false);
  }, []);

  // 挂载取数：setState 只发生在 promise 回调中，避免 effect 内同步 setState 级联渲染
  useEffect(() => {
    let cancelled = false;
    void fetchCrossSource(requestRef.current).then((result) => {
      if (!cancelled) applyLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLoad]);

  const retry = () => {
    setBusy(true);
    void fetchCrossSource(request).then(applyLoad);
  };

  /** 增/改/删共用：提交全量清单，成功后以服务端回传为准刷新 */
  const commit = async (mappings: MappingView[]): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await putCrossSource(request, mappings);
      if (result.ok) {
        setData(result.data);
        setErrors([]);
        return true;
      }
      setErrors(result.errors);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setErrors([]);
    setConfirmingIndex(null);
    setForm({
      index: null,
      projectSource: "",
      project: "",
      projectName: "",
      repoSource: "",
      repo: "",
    });
  };

  const openEdit = (index: number) => {
    const m = data?.mappings[index];
    if (!m) return;
    setErrors([]);
    setConfirmingIndex(null);
    setForm({
      index,
      projectSource: m.projectSource,
      project: m.project,
      projectName: m.projectName ?? "",
      repoSource: m.repoSource,
      repo: m.repo,
    });
  };

  const closeForm = () => {
    setForm(CLOSED_FORM);
    setErrors([]);
  };

  const submit = async () => {
    if (!form || !data || busy) return;
    const draft: MappingView = {
      projectSource: form.projectSource.trim(),
      project: form.project.trim(),
      ...(form.projectName.trim() ? { projectName: form.projectName.trim() } : {}),
      repoSource: form.repoSource.trim(),
      repo: form.repo.trim(),
    };
    // 必填项先行拦截；重复映射等规则以服务端校验为准
    if (!draft.projectSource || !draft.project || !draft.repoSource || !draft.repo) {
      setErrors(["项目管理侧数据源、项目、代码仓库侧数据源与仓库路径均不能为空"]);
      return;
    }
    const next =
      form.index === null
        ? [...data.mappings, draft]
        : data.mappings.map((m, i) => (i === form.index ? draft : m));
    if (await commit(next)) closeForm();
  };

  const remove = async (index: number) => {
    setConfirmingIndex(null);
    await commit((data?.mappings ?? []).filter((_, i) => i !== index));
  };

  const loading = !data && !loadError;
  const sourceById = new Map((data?.sources ?? []).map((s) => [s.id, s]));
  const projectListId = `${baseId}-project-sources`;
  const repoListId = `${baseId}-repo-sources`;
  const baseInputClass =
    "w-full p-2.5 rounded-lg border border-border bg-surface-sunken text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-border-strong";
  const inputClass = `${baseInputClass} font-mono`;
  const labelClass = "block text-muted-foreground mb-1 font-medium text-xs";

  const errorBox = (message: string) => (
    <div
      role="alert"
      className="text-[11px] text-danger-fg space-y-1 p-2 rounded-lg bg-danger-soft border border-danger-border"
    >
      {message}
      {errors.map((e) => (
        <div key={e}>· {e}</div>
      ))}
    </div>
  );

  const sourceOptions = (data?.sources ?? []).map((s) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  ));

  return (
    <div className="space-y-4 text-xs">
      {/* 头部：能力状态（服务端判定） */}
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-info-solid flex items-center justify-center text-white shrink-0">
          <Link2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm text-foreground">跨源联合分析映射</h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            把项目管理侧的项目与代码仓库侧的仓库对应起来，分析时可联合两边的迭代进度与代码活跃度。
            开启条件：至少一条映射，且映射双侧的数据源均已启用。
          </p>
        </div>
        {data && (
          <span
            role="status"
            className={`shrink-0 text-[10px] px-2 py-0.5 rounded font-medium ${
              data.active
                ? "bg-success-soft text-success-fg"
                : "bg-warning-soft text-warning-fg-strong"
            }`}
          >
            {data.active ? "已开启" : "未开启"}
          </span>
        )}
      </div>

      {loading && (
        <div className="py-8 text-center text-[11px] text-foreground-faint">
          正在加载跨源映射...
        </div>
      )}

      {!loading && loadError && (
        <div className="py-8 text-center space-y-3">
          <AlertTriangle className="w-5 h-5 mx-auto text-warning-fg" />
          <p className="text-xs text-muted-foreground">加载失败：{loadError}</p>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info-solid hover:bg-info-solid-hover text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重试
          </button>
        </div>
      )}

      {!loading && !loadError && data && (
        <>
          {data.mappings.length === 0 && !form && (
            <div className="border border-dashed border-border-strong rounded-lg p-4 text-center text-[11px] text-foreground-faint">
              暂无映射
            </div>
          )}

          {/* 删除失败的错误提示（表单打开时错误提示随表单展示） */}
          {errors.length > 0 && !form && errorBox("保存失败：")}

          <div className="space-y-2">
            {data.mappings.map((m, index) => {
              const confirming = confirmingIndex === index;
              return (
                <div
                  key={`${m.projectSource}:${m.project}:${index}`}
                  className="border border-border rounded-lg px-3 py-2.5 flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <MappingSide
                      label="项目管理侧"
                      sourceId={m.projectSource}
                      primary={m.project}
                      secondary={m.projectName}
                      source={sourceById.get(m.projectSource)}
                    />
                    <ArrowRight className="w-3.5 h-3.5 text-foreground-faint shrink-0" />
                    <MappingSide
                      label="代码仓库侧"
                      sourceId={m.repoSource}
                      primary={m.repo}
                      source={sourceById.get(m.repoSource)}
                    />
                  </div>

                  {confirming ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[11px] text-danger-fg font-medium">
                        确认删除？
                      </span>
                      <button
                        type="button"
                        onClick={() => void remove(index)}
                        disabled={busy}
                        aria-label={`确认删除映射 ${index + 1}`}
                        className="px-2 py-0.5 text-[11px] bg-danger-solid hover:bg-danger-solid-hover text-white rounded font-medium transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingIndex(null)}
                        className="px-1.5 py-0.5 text-[11px] border border-border hover:bg-muted text-foreground-subtle rounded transition-colors cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <Hint label="编辑">
                        <button
                          type="button"
                          onClick={() => openEdit(index)}
                          disabled={busy}
                          aria-label={`编辑映射 ${index + 1}`}
                          className="p-1 rounded text-foreground-faint hover:text-foreground-subtle hover:bg-muted disabled:opacity-50 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </Hint>
                      <Hint label="删除">
                        <button
                          type="button"
                          onClick={() => setConfirmingIndex(index)}
                          disabled={busy}
                          aria-label={`删除映射 ${index + 1}`}
                          className="p-1 rounded text-foreground-faint hover:text-danger-fg hover:bg-muted disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Hint>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!form && (
            <button
              type="button"
              onClick={openCreate}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border-strong text-muted-foreground hover:bg-surface-sunken transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加映射</span>
            </button>
          )}

          {form && (
            <div className="border border-border rounded-lg p-3 space-y-3 bg-surface-sunken/50">
              <div className="font-medium text-foreground">
                {form.index === null ? "添加映射" : "编辑映射"}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`${baseId}-project-source`} className={labelClass}>
                    项目管理侧数据源
                  </label>
                  <input
                    id={`${baseId}-project-source`}
                    list={projectListId}
                    type="text"
                    value={form.projectSource}
                    onChange={(e) =>
                      setForm({ ...form, projectSource: e.target.value })
                    }
                    placeholder="数据源 id"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-project`} className={labelClass}>
                    项目标识
                  </label>
                  <input
                    id={`${baseId}-project`}
                    type="text"
                    value={form.project}
                    onChange={(e) => setForm({ ...form, project: e.target.value })}
                    placeholder="项目管理侧的项目 ID"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-repo-source`} className={labelClass}>
                    代码仓库侧数据源
                  </label>
                  <input
                    id={`${baseId}-repo-source`}
                    list={repoListId}
                    type="text"
                    value={form.repoSource}
                    onChange={(e) =>
                      setForm({ ...form, repoSource: e.target.value })
                    }
                    placeholder="数据源 id"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-repo`} className={labelClass}>
                    仓库路径
                  </label>
                  <input
                    id={`${baseId}-repo`}
                    type="text"
                    value={form.repo}
                    onChange={(e) => setForm({ ...form, repo: e.target.value })}
                    placeholder="代码仓库侧的仓库路径"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor={`${baseId}-project-name`} className={labelClass}>
                    项目名称（可选）
                  </label>
                  <input
                    id={`${baseId}-project-name`}
                    type="text"
                    value={form.projectName}
                    onChange={(e) =>
                      setForm({ ...form, projectName: e.target.value })
                    }
                    placeholder="展示名"
                    className={baseInputClass}
                  />
                </div>
              </div>

              {/* 源 id 既可从已配置的数据源中选，也可手填（映射可先于数据源建立） */}
              <datalist id={projectListId}>{sourceOptions}</datalist>
              <datalist id={repoListId}>{sourceOptions}</datalist>

              {errors.length > 0 && errorBox("保存失败：")}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className="px-4 py-1.5 rounded-lg bg-info-solid text-white text-xs font-medium hover:bg-info-solid-hover shadow-xs disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                >
                  {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>保存</span>
                </button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-foreground-faint">
            映射保存在{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-muted-foreground">
              config/cross-source-map.json
            </code>
            ，保存后立即生效。
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 映射的一侧：数据源 id 徽标 + 主标识 + 次要信息。
 * 源已配置但处于停用态时给出提示（未出现在源列表里的 id 不提示，如 MCP 扩展服务）。
 */
function MappingSide({
  label,
  sourceId,
  primary,
  secondary,
  source,
}: {
  label: string;
  sourceId: string;
  primary: string;
  secondary?: string;
  source?: SourceView;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="text-[10px] text-foreground-faint flex items-center gap-1.5">
        <span className="shrink-0">{label}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-foreground-subtle truncate">
          {sourceId}
        </span>
        {source && !source.enabled && (
          <span className="shrink-0 text-warning-fg-strong">已停用</span>
        )}
      </div>
      <div className="font-mono text-foreground truncate">{primary}</div>
      {secondary && (
        <div className="text-[11px] text-muted-foreground truncate">{secondary}</div>
      )}
    </div>
  );
}
