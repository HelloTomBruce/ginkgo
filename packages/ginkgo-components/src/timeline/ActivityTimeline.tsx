"use client";

import { GitCommit, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { parseArrayProp } from "../internal/parseProp";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface TimelineItem {
  time: string;
  title: string;
  desc?: string;
  status?: "success" | "warning" | "error" | "info";
  author?: string;
  tag?: string;
}

export interface ActivityTimelineProps {
  title?: string;
  description?: string;
  items: TimelineItem[];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  title = "活动与事件轨迹",
  description,
  items = [],
}) => {
  const safeItems: TimelineItem[] = parseArrayProp(items).map((it) => ({
    time: String(it.time || it.date || it.created_at || "最近"),
    title: String(it.title || it.message || it.name || "事件记录"),
    desc: it.desc || it.description ? String(it.desc || it.description) : undefined,
    status: (["success", "warning", "error", "info"].includes(String(it.status)) ? it.status : "info") as TimelineItem["status"],
    author: it.author || it.author_name ? String(it.author || it.author_name) : undefined,
    tag: it.tag ? String(it.tag) : undefined,
  }));

  const statusIcons = {
    success: <CheckCircle2 className="w-3.5 h-3.5 text-success-fg" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-warning-fg" />,
    error: <XCircle className="w-3.5 h-3.5 text-danger-fg" />,
    info: <GitCommit className="w-3.5 h-3.5 text-info-fg" />,
  };

  const statusDotBg = {
    success: "bg-success-solid/10 border-success-solid/30",
    warning: "bg-warning-solid/10 border-warning-solid/30",
    error: "bg-danger-solid/10 border-danger-solid/30",
    info: "bg-info-solid/10 border-info-solid/30",
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      <div className="mb-4">
        {title && (
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-info-fg" />
            <span>{title}</span>
          </h3>
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-raised">
        {safeItems.length === 0 ? (
          <div className="text-xs text-foreground-faint text-center py-4">
            暂无时间线记录
          </div>
        ) : (
          safeItems.map((item, idx) => {
            const status = item.status || "info";
            return (
              <div key={`timeline-${idx}`} className="relative group">
                {/* 节点图标 */}
                <div
                  className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full border flex items-center justify-center bg-card ${statusDotBg[status] || statusDotBg.info}`}
                >
                  {statusIcons[status] || statusIcons.info}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-semibold text-foreground-strong">
                      {item.title}
                    </span>
                    {item.tag && (
                      <span className="text-[10px] bg-muted text-foreground-subtle px-1.5 py-0.5 rounded font-mono">
                        {item.tag}
                      </span>
                    )}
                    {item.author && (
                      <span className="text-[10px] text-foreground-faint">@{item.author}</span>
                    )}
                    <span className="text-[10px] text-foreground-faint ms-auto font-mono">
                      {item.time}
                    </span>
                  </div>

                  {item.desc && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {item.desc}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ===== UiSpec 组件库定义 =====
export const ActivityTimelineDef = defineComponent({
  name: "ActivityTimeline",
  description: "垂直事件时间线，用于展示 GitLab Merge Request 合并历史、版本发版里程碑或业务事件流",
  props: z.object({
    title: z.any().optional().describe("时间线标题"),
    description: z.any().optional().describe("说明描述"),
    items: z.any().optional().describe("时间线事件列表"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ActivityTimeline">
        <ActivityTimeline
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          items={props?.items as React.ComponentProps<typeof ActivityTimeline>["items"]}
        />
      </ComponentSafeWrapper>
    );
  },
});
