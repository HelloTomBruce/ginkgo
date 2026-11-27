"use client";

import React from "react";
import { X } from "lucide-react";
import { describeIdentityHeaders, type ProviderHeader } from "@/lib/llmProviders";

/**
 * Provider 级自定义请求头编辑器（从 SettingsModal 提取，控制其文件规模）。
 *
 * 用途：网关要求额外头的场景（如 OpenCode Go 的 x-opencode-session）。
 * 身份适配层已按端点自动注入默认头（见 providerTargets 的规则表），
 * 此编辑器只用于覆盖默认值或补充其它网关的自定义头。
 */
interface ProviderHeadersEditorProps {
  headers: ProviderHeader[];
  onChange: (headers: ProviderHeader[]) => void;
  /** 当前编辑的 API 地址：驱动「该端点会自动带哪些头」的提示 */
  baseURL: string;
}

export function ProviderHeadersEditor({ headers, onChange, baseURL }: ProviderHeadersEditorProps) {
  const update = (idx: number, patch: Partial<ProviderHeader>) => {
    onChange(headers.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const remove = (idx: number) => {
    onChange(headers.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground-subtle">
          自定义请求头
          <span className="ml-1 text-[10px] font-normal text-foreground-faint">
            （可选，如 x-opencode-session）
          </span>
        </label>
        <button
          type="button"
          onClick={() => onChange([...headers, { name: "", value: "" }])}
          className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-card hover:bg-muted text-foreground-subtle hover:text-foreground transition-colors cursor-pointer"
        >
          + 添加
        </button>
      </div>
      {/* 提示常显（而非仅空态显示）：用户加行后仍能看到该端点已自动带哪些头，
          避免重复配置手填的同名头 */}
      <p className="text-[10px] text-foreground-faint leading-relaxed">
        {describeIdentityHeaders(baseURL)}
        {" "}此处仅用于覆盖默认值或补充其它网关的自定义头；值支持{" "}
        <code className="font-mono">{"{{sessionId}}"}</code> 占位符（替换为当前会话 ID）。
        Authorization / Content-Type 等敏感头由服务端拒绝。
      </p>
      {headers.length > 0 && (
        <div className="space-y-1.5">
          {headers.map((h, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <input
                value={h.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                placeholder="Header 名"
                className="w-2/5 p-2 rounded-lg border border-border bg-card font-mono text-[11px]"
              />
              <input
                value={h.value}
                onChange={(e) => update(idx, { value: e.target.value })}
                placeholder="值"
                className="flex-1 p-2 rounded-lg border border-border bg-card font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                className="p-1.5 rounded-md text-foreground-faint hover:text-danger-fg hover:bg-danger-soft transition-colors cursor-pointer"
                title="删除该请求头"
                aria-label="删除该请求头"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
