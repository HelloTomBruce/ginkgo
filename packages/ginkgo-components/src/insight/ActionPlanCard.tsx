"use client";

import React from "react";
import { useTriggerAction } from "@openuidev/react-lang";
import { ArrowRight, Zap } from "lucide-react";
import { parseArrayProp } from "../internal/parseProp";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface ActionItem {
  title: string;
  priority?: "high" | "medium" | "low";
  impact?: string;
  owner?: string;
  status?: "todo" | "in_progress" | "done";
}

export interface ActionPlanCardProps {
  title?: string;
  description?: string;
  actions: ActionItem[];
}

export const ActionPlanCard: React.FC<ActionPlanCardProps> = ({
  title = "AI 归因建议与落地行动清单",
  description,
  actions = [],
}) => {
  const triggerAction = useTriggerAction();

  const safeActions: ActionItem[] = parseArrayProp(actions).map((a) => ({
    title: String(a.title || a.name || a.desc || "待办事项"),
    priority: (["high", "medium", "low"].includes(String(a.priority)) ? a.priority : "medium") as ActionItem["priority"],
    impact: a.impact ? String(a.impact) : undefined,
    owner: a.owner ? String(a.owner) : undefined,
    status: (["todo", "in_progress", "done"].includes(String(a.status)) ? a.status : "todo") as ActionItem["status"],
  }));

  const handleExecuteAction = (item: ActionItem) => {
    if (triggerAction) {
      triggerAction(`【执行行动项】请针对「${item.title}」进行进一步深入分析，给出具体实施方案及预期收益测算。`);
    }
  };

  const priorityStyles = {
    high: "bg-danger-soft text-danger-fg-strong border-danger-border",
    medium: "bg-warning-soft text-warning-fg-strong border-warning-border",
    low: "bg-info-soft text-info-fg-strong border-info-border",
  };

  const priorityLabels = {
    high: "高优决策",
    medium: "中优改进",
    low: "日常优化",
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-warning-fg" />
            <span>{title}</span>
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        <span className="text-[10px] bg-muted text-foreground-subtle px-2 py-0.5 rounded-full font-medium">
          共 {safeActions.length} 项措施
        </span>
      </div>

      <div className="space-y-2.5">
        {safeActions.length === 0 ? (
          <div className="text-xs text-foreground-faint text-center py-4">
            暂无行动项建议
          </div>
        ) : (
          safeActions.map((action, idx) => {
            const priority = action.priority || "medium";
            return (
              <div
                key={`action-${idx}`}
                className="group p-3 rounded-lg border border-border/80 bg-surface-sunken hover:bg-muted/70 transition-colors duration-150 flex items-start gap-3 justify-between"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${priorityStyles[priority]}`}
                    >
                      {priorityLabels[priority]}
                    </span>
                    <h4 className="text-xs font-semibold text-foreground-strong">
                      {action.title}
                    </h4>
                  </div>
                  {action.impact && (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <span className="font-medium text-success-fg">预期成效:</span>
                      <span>{action.impact}</span>
                    </p>
                  )}
                  {action.owner && (
                    <span className="text-[10px] text-foreground-faint">责任人: {action.owner}</span>
                  )}
                </div>

                <button
                  onClick={() => handleExecuteAction(action)}
                  className="shrink-0 opacity-80 group-hover:opacity-100 p-1.5 bg-card border border-border rounded-md text-foreground-subtle hover:text-info-fg hover:border-info-border-strong active:scale-95 text-xs flex items-center gap-1 shadow-2xs transition-all duration-150"
                  title="触发深入分析"
                >
                  <span className="text-[11px]">拆解</span>
                  <ArrowRight className="w-3 h-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ===== UiSpec 组件库定义 =====
export const ActionPlanCardDef = defineComponent({
  name: "ActionPlanCard",
  description: "大模型归因后给出的具体落地措施与优化行动清单，支持交互式点击触发进一步深度拆解",
  props: z.object({
    title: z.any().optional().describe("行动建议清单标题"),
    description: z.any().optional().describe("行动清单背景说明"),
    actions: z.any().optional().describe("行动建议项列表"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ActionPlanCard">
        <ActionPlanCard
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          actions={props?.actions as React.ComponentProps<typeof ActionPlanCard>["actions"]}
        />
      </ComponentSafeWrapper>
    );
  },
});
