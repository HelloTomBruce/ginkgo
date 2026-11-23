"use client";

import React, { useState } from "react";
import { useTriggerAction, useSetFieldValue, defineComponent } from "@openuidev/react-lang";
import { Calculator, Sparkles, Download, AlertTriangle } from "lucide-react";
import { z } from "zod";
import { toCsvContent, downloadCsv } from "../internal/csv";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface ReactiveSimulatorProps {
  title?: string;
  defaultBudget?: number;
  channelName?: string;
  currentCac?: number;
  cvrRate?: number;
  avgOrderValue?: number;
}

export const ReactiveSimulator: React.FC<ReactiveSimulatorProps> = ({
  title = "响应式预算模拟与本地实时试算器",
  defaultBudget = 50000,
  channelName = "TikTok Ads",
  currentCac = 19.87,
  cvrRate = 0.146,
  avgOrderValue = 1500,
}) => {
  const triggerAction = useTriggerAction();
  const setFieldValue = useSetFieldValue();

  // 本地响应式状态
  const [budget, setBudget] = useState(defaultBudget);
  const [targetCac, setTargetCac] = useState(currentCac);
  const [customCvr, setCustomCvr] = useState(Math.round(cvrRate * 100));

  // 声明式约束校验
  const [validationError, setValidationError] = useState<string | null>(null);

  // 实时本地响应式计算 (纯前端毫秒级刷新，不依赖 LLM 延迟)
  const estimatedLeads = targetCac > 0 ? Math.round(budget / targetCac) : 0;
  const estimatedDeals = Math.round(estimatedLeads * (customCvr / 100));
  const estimatedRevenue = estimatedDeals * avgOrderValue;
  const estimatedRoi = budget > 0 ? ((estimatedRevenue - budget) / budget).toFixed(2) : "0";

  const handleBudgetChange = (val: number) => {
    // 约束校验规则
    if (val < 1000) {
      setValidationError("预算金额不可低于 $1,000");
    } else if (val > 1000000) {
      setValidationError("单渠道模拟上限不可超过 $1,000,000");
    } else {
      setValidationError(null);
    }
    setBudget(val);
    if (setFieldValue) {
      setFieldValue(undefined, "ReactiveSimulator", "budget", val);
    }
  };

  const handleExportSimulation = () => {
    // 直接走包内 csv 工具导出（clientTools 的 export_csv 是 app 侧 toast 封装，
    // 组件包不依赖 app 的 toast store；下载行为与 clientTools 完全一致）
    downloadCsv(
      `simulation_${channelName}_budget_${budget}.csv`,
      toCsvContent(
        ["渠道", "模拟预算 ($)", "预估 CAC ($)", "转化率 (%)", "预期线索数", "预期成交数", "预期营收 ($)", "预估 ROI"],
        [
          [
            channelName,
            budget,
            targetCac,
            `${customCvr}%`,
            estimatedLeads,
            estimatedDeals,
            estimatedRevenue,
            estimatedRoi,
          ],
        ]
      )
    );
  };

  const handleAskAIToAudit = () => {
    if (validationError) return;
    if (triggerAction) {
      triggerAction(
        `【响应式试算回传】我针对渠道「${channelName}」在预算 $${budget.toLocaleString()}、目标 CAC $${targetCac}、成交转化率 ${customCvr}% 条件下进行了测算，预计产出 ${estimatedLeads.toLocaleString()} 条线索与 $${estimatedRevenue.toLocaleString()} 营收 (ROI: ${estimatedRoi})。请对此方案进行专业风险评估与归因分析。`
      );
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Calculator className="w-4 h-4 text-info-fg" />
            <span>{title}</span>
          </h3>
          <p className="text-xs text-foreground-faint mt-0.5">
            响应式状态（Reactive State）+ 校验约束（Validation）+ 客户端工具（Client Tools）
          </p>
        </div>
        <span className="text-[10px] bg-indigo-soft text-indigo-fg px-2.5 py-1 rounded-full font-semibold border border-indigo-border">
          ⚡ 客户端毫秒响应
        </span>
      </div>

      {/* 参数滑块与输入 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs bg-surface-sunken dark:bg-surface-inverse/50 p-4 rounded-xl border border-border-subtle">
        <div>
          <div className="flex justify-between font-medium mb-1">
            <span className="text-foreground-subtle">模拟投放预算</span>
            <span className="font-mono text-info-fg font-bold">
              ${budget.toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min="1000"
            max="1000000"
            step="10000"
            value={budget}
            onChange={(e) => handleBudgetChange(Number(e.target.value))}
            className="w-full h-1.5 bg-surface-raised rounded-lg appearance-none cursor-pointer accent-info-solid"
          />
        </div>

        <div>
          <div className="flex justify-between font-medium mb-1">
            <span className="text-foreground-subtle">目标获客成本 (CAC)</span>
            <span className="font-mono text-success-fg font-bold">
              ${targetCac.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="1"
            value={targetCac}
            onChange={(e) => setTargetCac(Math.max(0, Number(e.target.value)))}
            className="w-full h-1.5 bg-surface-raised rounded-lg appearance-none cursor-pointer accent-success-solid"
          />
        </div>

        <div>
          <div className="flex justify-between font-medium mb-1">
            <span className="text-foreground-subtle">预估成交转化率 (CVR)</span>
            <span className="font-mono text-violet-fg font-bold">
              {customCvr}%
            </span>
          </div>
          <input
            type="range"
            min="5"
            max="40"
            step="1"
            value={customCvr}
            onChange={(e) => setCustomCvr(Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-full h-1.5 bg-surface-raised rounded-lg appearance-none cursor-pointer accent-violet-fg"
          />
        </div>
      </div>

      {/* 校验错误提示 */}
      {validationError && (
        <div className="flex items-center gap-1.5 text-xs text-danger-fg bg-danger-soft p-2.5 rounded-lg border border-danger-border">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* 实时响应式联动计算结果卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-sunken p-3 rounded-lg border border-border/60">
          <div className="text-[11px] text-foreground-faint">预期线索获取</div>
          <div className="text-lg font-bold text-foreground-strong font-mono mt-0.5">
            {estimatedLeads.toLocaleString()} <span className="text-xs font-normal">条</span>
          </div>
        </div>

        <div className="bg-surface-sunken p-3 rounded-lg border border-border/60">
          <div className="text-[11px] text-foreground-faint">预期签约成单</div>
          <div className="text-lg font-bold text-success-fg font-mono mt-0.5">
            {estimatedDeals.toLocaleString()} <span className="text-xs font-normal">单</span>
          </div>
        </div>

        <div className="bg-surface-sunken p-3 rounded-lg border border-border/60">
          <div className="text-[11px] text-foreground-faint">预估贡献营收</div>
          <div className="text-lg font-bold text-info-fg font-mono mt-0.5">
            ${estimatedRevenue.toLocaleString()}
          </div>
        </div>

        <div className="bg-surface-sunken p-3 rounded-lg border border-border/60">
          <div className="text-[11px] text-foreground-faint">预估投产比 (ROI)</div>
          <div className="text-lg font-bold text-violet-fg font-mono mt-0.5">
            {estimatedRoi}x
          </div>
        </div>
      </div>

      {/* 底部多步操作栏 */}
      <div className="flex items-center justify-between pt-2 border-t border-border-subtle flex-wrap gap-2">
        <button
          onClick={handleExportSimulation}
          className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium text-foreground-subtle flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-muted-foreground" />
          <span>客户端一键导出测算表 (Client Tool)</span>
        </button>

        <button
          onClick={handleAskAIToAudit}
          disabled={!!validationError}
          className="px-3.5 py-1.5 rounded-lg bg-info-solid hover:bg-info-solid-hover text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>将此测算案交由 Agent 深度归因 (ToAssistant)</span>
        </button>
      </div>
    </div>
  );
};

// ===== UiSpec 组件库定义 =====
export const ReactiveSimulatorDef = defineComponent({
  name: "ReactiveSimulator",
  description: "响应式预算模拟与本地实时试算器，集成响应式状态绑定、表单约束校验与客户端一键导出",
  props: z.object({
    title: z.any().optional().describe("试算器标题"),
    defaultBudget: z.any().optional().describe("默认模拟预算金额"),
    channelName: z.any().optional().describe("聚焦分析渠道"),
    currentCac: z.any().optional().describe("基准获客成本 CAC"),
    cvrRate: z.any().optional().describe("预估转化率"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ReactiveSimulator">
        <ReactiveSimulator
          title={props?.title ? String(props.title) : undefined}
          defaultBudget={typeof props?.defaultBudget === "number" ? props.defaultBudget : Number(props?.defaultBudget) || 50000}
          channelName={props?.channelName ? String(props.channelName) : "TikTok Ads"}
          currentCac={typeof props?.currentCac === "number" ? props.currentCac : Number(props?.currentCac) || 20}
          cvrRate={typeof props?.cvrRate === "number" ? props.cvrRate : Number(props?.cvrRate) || 0.1}
        />
      </ComponentSafeWrapper>
    );
  },
});
