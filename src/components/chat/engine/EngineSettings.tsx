"use client";

import React from "react";
import {
  Zap,
  ShieldCheck,
  Clock,
  Sparkles,
  Server,
} from "lucide-react";
import { useHarnessSettings } from "@/hooks/useHarnessSettings";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface EngineSettingsProps {
  maxSteps?: string;
  onMaxStepsChange?: (v: string) => void;
  fallbackModels?: string;
  onFallbackModelsChange?: (v: string) => void;
}

export function EngineSettings({
  maxSteps = "",
  onMaxStepsChange,
  fallbackModels = "",
  onFallbackModelsChange,
}: EngineSettingsProps) {
  const { settings, updateEngine } = useHarnessSettings();
  const { engine } = settings;

  const handleApplyPreset = (preset: "standard" | "resilient" | "fast") => {
    if (preset === "standard") {
      updateEngine({
        timeoutSeconds: 30,
        maxRetries: 3,
        backoffFactor: 2.0,
        autoHealing: true,
        autoHealingAttempts: 2,
      });
      onMaxStepsChange?.("25");
    } else if (preset === "resilient") {
      updateEngine({
        timeoutSeconds: 60,
        maxRetries: 5,
        backoffFactor: 2.0,
        autoHealing: true,
        autoHealingAttempts: 3,
      });
      onMaxStepsChange?.("35");
    } else if (preset === "fast") {
      updateEngine({
        timeoutSeconds: 15,
        maxRetries: 1,
        backoffFactor: 1.5,
        autoHealing: false,
        autoHealingAttempts: 1,
      });
      onMaxStepsChange?.("15");
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* 头部说明与推荐预设 */}
      <div>
        <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
          <Zap className="w-4 h-4 text-info-fg" />
          <span>Harness 引擎调度与韧性配置</span>
        </h3>
        <p className="text-[11px] text-foreground-subtle mt-0.5">
          调控 Harness-Core 编排引擎的请求超时、重试退避、思考循环步数上限及语法智能自愈策略。
        </p>
      </div>

      {/* 快速预设 */}
      <div className="p-3 rounded-xl bg-surface-sunken border border-border-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-warning-fg" />
          <span className="font-medium text-foreground">快速推荐档位：</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleApplyPreset("standard")}
            className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground-subtle cursor-pointer transition-colors"
          >
            标准均衡（默认）
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset("resilient")}
            className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground-subtle cursor-pointer transition-colors"
          >
            高可靠健壮
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset("fast")}
            className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground-subtle cursor-pointer transition-colors"
          >
            轻量极速
          </button>
        </div>
      </div>

      {/* 模块 1：执行与韧性 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-info-fg" />
            <h4 className="font-semibold text-foreground">执行与韧性策略（Resilience）</h4>
          </div>
          <span className="text-[10px] text-foreground-faint font-mono">
            超时 {engine.timeoutSeconds}s · 重试 {engine.maxRetries} 次
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-muted-foreground mb-1 font-medium">
              请求超时上限（秒）
            </label>
            <input
              type="number"
              min="5"
              max="300"
              value={engine.timeoutSeconds}
              onChange={(e) =>
                updateEngine({ timeoutSeconds: Number(e.target.value) || 30 })
              }
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
            <p className="text-[10px] text-foreground-faint mt-1">
              单次 LLM 推理或工具调用最大等待时间
            </p>
          </div>

          <div>
            <label className="block text-muted-foreground mb-1 font-medium">
              网络/限流失败重试次数
            </label>
            <input
              type="number"
              min="0"
              max="5"
              value={engine.maxRetries}
              onChange={(e) =>
                updateEngine({ maxRetries: Number(e.target.value) || 0 })
              }
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
            <p className="text-[10px] text-foreground-faint mt-1">
              遇 429 或网络瞬断时自动重发次数
            </p>
          </div>

          <div>
            <label className="block text-muted-foreground mb-1 font-medium">
              指数退避倍数（Backoff）
            </label>
            <input
              type="number"
              min="1.0"
              max="5.0"
              step="0.5"
              value={engine.backoffFactor}
              onChange={(e) =>
                updateEngine({ backoffFactor: Number(e.target.value) || 2.0 })
              }
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
            <p className="text-[10px] text-foreground-faint mt-1">
              每次重试延迟递增基数（默认 2.0x）
            </p>
          </div>
        </div>

        {/* 最大步数与降级模型配置同步 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border-subtle">
          <div>
            <label className="block text-muted-foreground mb-1 font-medium flex items-center justify-between">
              <span>最大思考步数上限（Max Steps）</span>
              <span className="font-mono text-foreground-faint">
                {maxSteps && Number(maxSteps) > 0 ? `${maxSteps} 步` : "默认 25 步"}
              </span>
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={maxSteps}
              onChange={(e) => onMaxStepsChange?.(e.target.value)}
              placeholder="默认 25 步（双重终态防死循环）"
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-muted-foreground mb-1 font-medium flex items-center justify-between">
              <span>备选降级模型（Fallback Models）</span>
              <span className="font-mono text-foreground-faint text-[10px]">
                {fallbackModels.trim()
                  ? `${fallbackModels.split(/[,，\s]+/).filter(Boolean).length} 个备选`
                  : "未配置"}
              </span>
            </label>
            <input
              type="text"
              value={fallbackModels}
              onChange={(e) => onFallbackModelsChange?.(e.target.value)}
              placeholder="如: gpt-4o-mini, qwen-plus"
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* 模块 2：智能护栏与自愈 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-success-fg" />
            <h4 className="font-semibold text-foreground">智能护栏与代码自愈（Guardrails）</h4>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              engine.autoHealing
                ? "bg-success-soft text-success-fg"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {engine.autoHealing ? "自愈生效中" : "已关闭"}
          </span>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-foreground">
                启用看板 DSL 语法自愈（OpenUI Spec Self-Healing）
              </div>
              <p className="text-[11px] text-foreground-subtle mt-0.5">
                当大模型生成的图表 JSON 或前端看板代码出现语法微瑕、字段拼写错误或类型中断时，Harness 会自动携带错误调用专用自愈通道纠错，无需重新全量生成。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={engine.autoHealing}
                onChange={(e) => updateEngine({ autoHealing: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-surface-raised peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-info-solid"></div>
            </label>
          </div>

          {engine.autoHealing && (
            <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
              <span className="text-muted-foreground font-medium">自愈重试最大次数</span>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => updateEngine({ autoHealingAttempts: num })}
                    className={`px-3 py-1 rounded-lg border text-xs cursor-pointer font-medium transition-all ${
                      engine.autoHealingAttempts === num
                        ? "border-info-border bg-info-soft text-info-fg"
                        : "border-border bg-card text-foreground-subtle hover:bg-muted"
                    }`}
                  >
                    {num} 次尝试
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 模块 3：运行时后端存储 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-brand-fg" />
            <h4 className="font-semibold text-foreground">状态与任务流存储后端（Storage Backend）</h4>
          </div>
          <span className="font-mono text-[10px] text-foreground-faint uppercase">
            {engine.storageType}
          </span>
        </div>

        <RadioGroup
          value={engine.storageType}
          onValueChange={(v) =>
            updateEngine({ storageType: v as "memory" | "file" | "redis" })
          }
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted">
            <RadioGroupItem value="memory" className="mt-0.5" />
            <div>
              <div className="font-medium text-foreground">内存存储 (Memory)</div>
              <div className="text-[10px] text-foreground-faint leading-normal mt-0.5">
                极速响应，适合单机轻量部署与开发联调，进程重启后状态清空。
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted">
            <RadioGroupItem value="file" className="mt-0.5" />
            <div>
              <div className="font-medium text-foreground">本地文件 (File Store)</div>
              <div className="text-[10px] text-foreground-faint leading-normal mt-0.5">
                持久化到本地磁盘 data 目录，进程重启状态不丢失。
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted">
            <RadioGroupItem value="redis" className="mt-0.5" />
            <div>
              <div className="font-medium text-foreground">企业分布式 (Redis)</div>
              <div className="text-[10px] text-foreground-faint leading-normal mt-0.5">
                高可用生产集群，支持跨节点分布式任务中继与分布式锁。
              </div>
            </div>
          </label>
        </RadioGroup>

        {engine.storageType === "redis" && (
          <div className="pt-2 border-t border-border-subtle">
            <label className="block text-muted-foreground mb-1 font-medium">
              Redis 连接 URL *
            </label>
            <input
              type="text"
              value={engine.redisUrl}
              onChange={(e) => updateEngine({ redisUrl: e.target.value })}
              placeholder="redis://:password@127.0.0.1:6379/0"
              className="w-full p-2.5 rounded-lg border border-border bg-surface-sunken font-mono text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}
