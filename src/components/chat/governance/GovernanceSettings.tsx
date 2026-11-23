"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  DollarSign,
  Activity,
  FileJson,
  Download,
  Upload,
  RotateCcw,
  CheckCircle2,
  Copy,
  Key,
} from "lucide-react";
import { useHarnessSettings } from "@/hooks/useHarnessSettings";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/lib/toast";

export interface GovernanceSettingsProps {
  accessToken?: string;
  onAccessTokenChange?: (v: string) => void;
}

export function GovernanceSettings({
  accessToken = "",
  onAccessTokenChange,
}: GovernanceSettingsProps = {}) {
  const {
    settings,
    updateGovernance,
    resetToDefaults,
    exportConfigJson,
    importConfigJson,
  } = useHarnessSettings();
  const { governance } = settings;

  const [importJsonText, setImportJsonText] = useState("");
  const [showImport, setShowImport] = useState(false);

  const handleExport = () => {
    try {
      const jsonStr = exportConfigJson();
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ginkgo-harness-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("已导出 Harness 配置文件");
    } catch {
      toast.error("导出配置失败");
    }
  };

  const handleCopyJson = async () => {
    try {
      const jsonStr = exportConfigJson();
      await navigator.clipboard.writeText(jsonStr);
      toast.success("配置 JSON 已复制到剪贴板");
    } catch {
      toast.error("复制到剪贴板失败");
    }
  };

  const handleImport = () => {
    if (!importJsonText.trim()) {
      toast.error("请粘贴配置 JSON");
      return;
    }
    const res = importConfigJson(importJsonText);
    if (res.success) {
      toast.success("成功导入并生效 Harness 配置");
      setShowImport(false);
      setImportJsonText("");
    } else {
      toast.error(`导入失败: ${res.error}`);
    }
  };

  const handleReset = () => {
    if (confirm("确定要将 Harness 引擎与治理参数恢复为出厂默认值吗？")) {
      resetToDefaults();
      toast.success("已恢复出厂默认基线");
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* 头部说明 */}
      <div>
        <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
          <ShieldCheck className="w-4 h-4 text-success-fg" />
          <span>治理观测与成本控制（Governance & FinOps）</span>
        </h3>
        <p className="text-[11px] text-foreground-subtle mt-0.5">
          实时监控大模型推理财务台账、配置租户级用量熔断阈值，并支持 OpenTelemetry 全链路分布式追踪。
        </p>
      </div>

      {/* 模块 1：FinOps 财务预算与熔断 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-warning-fg" />
            <h4 className="font-semibold text-foreground">FinOps 成本控制与预算熔断</h4>
          </div>
          <span className="text-[10px] text-foreground-faint font-mono">
            日预算 ${governance.dailyBudgetUsd} · 限额{" "}
            {Math.round(governance.tokenLimit / 1_000_000)}M tokens
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-muted-foreground mb-1 font-medium">
              每日最高消费预算上限（USD $）
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-foreground-faint font-mono">$</span>
              <input
                type="number"
                min="1"
                max="10000"
                step="5"
                value={governance.dailyBudgetUsd}
                onChange={(e) =>
                  updateGovernance({ dailyBudgetUsd: Number(e.target.value) || 50 })
                }
                className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
              />
            </div>
            <p className="text-[10px] text-foreground-faint mt-1">
              到达该金额时触发熔断保护，防止异常长循环产生意外账单
            </p>
          </div>

          <div>
            <label className="block text-muted-foreground mb-1 font-medium">
              每日 Token 消耗限额（Tokens）
            </label>
            <input
              type="number"
              min="100000"
              max="100000000"
              step="500000"
              value={governance.tokenLimit}
              onChange={(e) =>
                updateGovernance({ tokenLimit: Number(e.target.value) || 10_000_000 })
              }
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
            <p className="text-[10px] text-foreground-faint mt-1">
              当前配置相当于约 {Math.round(governance.tokenLimit / 1_000_000)} 百万 Tokens
            </p>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-sunken border border-border-subtle flex items-start gap-2 text-[11px] text-foreground-subtle">
          <CheckCircle2 className="w-4 h-4 text-success-fg flex-shrink-0 mt-0.5" />
          <span>
            Harness CostLedger 已接入官方定价表（OpenAI、Claude、DeepSeek、Qwen、Kimi、GLM 等），每轮对话会自动实时计算并在消息元信息微标与上下文指示器中显性化呈现。
          </span>
        </div>
      </div>

      {/* 模块 2：OpenTelemetry 遥测与链路追踪 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-info-fg" />
            <h4 className="font-semibold text-foreground">OpenTelemetry 遥测与链路追踪</h4>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              governance.telemetryEnabled
                ? "bg-info-soft text-info-fg"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {governance.telemetryEnabled ? "OTel 追踪开启" : "未启用"}
          </span>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-foreground">启用分布式链路追踪（OTel Spans）</div>
              <p className="text-[11px] text-foreground-subtle mt-0.5">
                记录包含 Agent 思考、模型推理、MCP 工具调用与数据源查询在内的全链路分布式 Span 追踪数据。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={governance.telemetryEnabled}
                onChange={(e) => updateGovernance({ telemetryEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-surface-raised peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-info-solid"></div>
            </label>
          </div>

          {governance.telemetryEnabled && (
            <div className="space-y-3 pt-2 border-t border-border-subtle">
              <div>
                <label className="block text-muted-foreground mb-1 font-medium flex items-center justify-between">
                  <span>链路采样率（Sample Rate）</span>
                  <span className="font-mono text-foreground-faint">
                    {governance.telemetrySampleRate}%
                  </span>
                </label>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[governance.telemetrySampleRate]}
                  onValueChange={([v]) => updateGovernance({ telemetrySampleRate: v })}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  OTel Collector HTTP 端点
                </label>
                <input
                  type="text"
                  value={governance.otelEndpoint}
                  onChange={(e) => updateGovernance({ otelEndpoint: e.target.value })}
                  placeholder="如: http://localhost:4318/v1/traces 或留空输出至服务端日志"
                  className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 模块 3：服务端访问鉴权 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-warning-fg" />
            <h4 className="font-semibold text-foreground">部署与网关鉴权（Gateway Auth）</h4>
          </div>
          <span className="font-mono text-[10px] text-foreground-faint">
            {accessToken ? "已配置令牌" : "未开启"}
          </span>
        </div>

        <div>
          <label
            htmlFor="settings-access-token"
            className="block text-muted-foreground mb-1 font-medium"
          >
            访问令牌（Access Token，可选）
          </label>
          <input
            id="settings-access-token"
            type="password"
            value={accessToken}
            onChange={(e) => onAccessTokenChange?.(e.target.value)}
            placeholder="服务端配置 GINKGO_API_AUTH_TOKEN 时必填"
            className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
          />
          <p className="text-[10px] text-foreground-faint mt-1">
            用于向私有化部署网关验证客户端合法性，留空走系统匿名访问
          </p>
        </div>
      </div>

      {/* 模块 4：配置管理与基线重置 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-brand-fg" />
            <h4 className="font-semibold text-foreground">配置运维与基线同步</h4>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground-subtle font-medium cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-info-fg" />
            <span>导出配置 JSON</span>
          </button>
          <button
            type="button"
            onClick={handleCopyJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground-subtle font-medium cursor-pointer transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>复制配置内容</span>
          </button>
          <button
            type="button"
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground-subtle font-medium cursor-pointer transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>导入配置...</span>
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-danger-soft text-danger-fg font-medium cursor-pointer transition-colors ml-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认基线</span>
          </button>
        </div>

        {showImport && (
          <div className="p-3 rounded-xl bg-surface-sunken border border-border-subtle space-y-2 mt-2">
            <label className="block text-[11px] font-medium text-foreground">
              粘贴导出的 Harness 配置 JSON 字符串：
            </label>
            <textarea
              rows={4}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="在此粘贴 JSON 内容..."
              className="w-full p-2 rounded-lg border border-border bg-card font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="px-3 py-1 rounded-lg border border-border text-foreground-subtle hover:bg-muted text-xs cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="px-3 py-1 rounded-lg bg-info-solid text-info-on-solid hover:bg-info-solid-hover text-xs font-medium cursor-pointer"
              >
                确认导入
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
