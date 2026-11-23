"use client";

import React, { useMemo, useState } from "react";
import { Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { parseArrayProp } from "../internal/parseProp";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface RankingItem {
  label: string;
  value: number | string;
  secondary?: string;
  ratio?: number; // 0 ~ 1
}

export interface RankingListProps {
  title?: string;
  subtitle?: string;
  items: RankingItem[];
  maxDisplay?: number;
  valueFormat?: "number" | "currency" | "percent" | "duration" | "text";
}

function formatRankingValue(
  val: number | string,
  format?: RankingListProps["valueFormat"]
): string {
  if (typeof val === "string") return val;
  if (!Number.isFinite(val)) return "-";

  switch (format) {
    case "currency":
      return `¥${val.toLocaleString()}`;
    case "percent":
      return `${(val * 100).toFixed(1)}%`;
    case "duration":
      return `${val}ms`;
    case "number":
    default:
      return val.toLocaleString();
  }
}

export const RankingList: React.FC<RankingListProps> = ({
  title,
  subtitle,
  items = [],
  maxDisplay = 5,
  valueFormat = "number",
}) => {
  const [expanded, setExpanded] = useState(false);

  const safeItems: RankingItem[] = useMemo(() => {
    return parseArrayProp(items)
      .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === "object"))
      .map((it) => ({
        label: String(it.label ?? it.name ?? "-"),
        value: typeof it.value === "number" || typeof it.value === "string" ? it.value : 0,
        secondary: it.secondary ? String(it.secondary) : undefined,
        ratio: typeof it.ratio === "number" ? Math.min(1, Math.max(0, it.ratio)) : undefined,
      }));
  }, [items]);

  // 计算最大值供相对进度条归一化
  const maxValue = useMemo(() => {
    let max = 0;
    for (const it of safeItems) {
      const num = Number(it.value);
      if (Number.isFinite(num) && num > max) max = num;
    }
    return max > 0 ? max : 1;
  }, [safeItems]);

  const displayList = expanded ? safeItems : safeItems.slice(0, maxDisplay);
  const hasMore = safeItems.length > maxDisplay;

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-xs w-full flex flex-col justify-between">
      <div>
        {/* 标题栏 */}
        {(title || subtitle) && (
          <div className="mb-4">
            {title && (
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Trophy className="w-4 h-4 text-warning-fg shrink-0" />
                <span className="truncate">{title}</span>
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        )}

        {/* 列表项 */}
        <div className="space-y-2.5">
          {displayList.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">暂无排行数据</div>
          ) : (
            displayList.map((item, idx) => {
              const rank = idx + 1;
              const numVal = Number(item.value);
              const barWidthPct =
                item.ratio !== undefined
                  ? Math.round(item.ratio * 100)
                  : Number.isFinite(numVal)
                  ? Math.min(100, Math.round((numVal / maxValue) * 100))
                  : 0;

              const rankBadgeClass =
                rank === 1
                  ? "bg-rank-1-soft text-rank-1-fg border border-rank-1-border"
                  : rank === 2
                  ? "bg-rank-2-soft text-rank-2-fg border border-rank-2-border"
                  : rank === 3
                  ? "bg-rank-3-soft text-rank-3-fg border border-rank-3-border"
                  : "bg-surface-sunken text-foreground-subtle border border-border";

              const rankBarClass =
                rank === 1
                  ? "bg-rank-1-solid"
                  : rank === 2
                  ? "bg-rank-2-solid"
                  : rank === 3
                  ? "bg-rank-3-solid"
                  : "bg-info-solid";

              return (
                <div
                  key={`${item.label}-${rank}`}
                  className="group relative flex flex-col justify-center rounded-lg p-2 transition-colors hover:bg-surface-raised"
                >
                  <div className="flex items-center justify-between gap-3 relative z-10 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${rankBadgeClass}`}
                      >
                        {rank}
                      </span>
                      <span className="font-medium text-foreground truncate" title={item.label}>
                        {item.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <span className="font-semibold text-foreground">
                        {formatRankingValue(item.value, valueFormat)}
                      </span>
                      {item.secondary && (
                        <span className="text-[11px] text-muted-foreground">
                          {item.secondary}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 行内进度条 */}
                  <div className="w-full h-1.5 bg-surface-sunken rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] transform-gpu ${rankBarClass}`}
                      style={{ width: `${barWidthPct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 展开/收起按钮 */}
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 pt-2 border-t border-border w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>{expanded ? "收起" : `查看更多 (${safeItems.length - maxDisplay})`}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
};

// ===== UiSpec 组件库定义 =====
export const RankingListDef = defineComponent({
  name: "RankingList",
  description: "高密排行榜组件，用于展示 Top N 核心实体、名次徽章及占比微进度条",
  props: z.object({
    title: z.any().optional().describe("排行榜标题"),
    subtitle: z.any().optional().describe("副标题或统计周期"),
    items: z.any().describe("排名项数组，每项包含 label, value, 可选 secondary 及 ratio"),
    maxDisplay: z.any().optional().describe("默认展示行数，默认 5"),
    valueFormat: z.any().optional().describe("数值格式化类型：number, currency, percent, duration, text"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = props?.title ? String(props.title) : undefined;
    const subtitle = props?.subtitle ? String(props.subtitle) : undefined;
    const items = (props?.items as RankingItem[]) ?? [];
    const maxDisplay = props?.maxDisplay ? Number(props.maxDisplay) : 5;
    const valueFormat = props?.valueFormat as RankingListProps["valueFormat"];

    return (
      <ComponentSafeWrapper name="RankingList">
        <RankingList
          title={title}
          subtitle={subtitle}
          items={items}
          maxDisplay={maxDisplay}
          valueFormat={valueFormat}
        />
      </ComponentSafeWrapper>
    );
  },
});
