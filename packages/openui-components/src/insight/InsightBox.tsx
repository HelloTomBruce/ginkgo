import React from "react";
import { Lightbulb, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface InsightBoxProps {
  type?: "tip" | "info" | "warning" | "success";
  title?: string;
  children?: React.ReactNode;
  content?: string;
}

export const InsightBox: React.FC<InsightBoxProps> = ({
  type = "info",
  title,
  children,
  content,
}) => {
  const defaultStyle = {
    bg: "bg-info-soft",
    border: "border-info-border",
    text: "text-info-fg-strong",
    icon: <Info className="w-4 h-4 text-info-fg" />,
  };

  const styles = {
    tip: {
      bg: "bg-warning-soft",
      border: "border-warning-border",
      text: "text-warning-fg-strong",
      icon: <Lightbulb className="w-4 h-4 text-warning-fg" />,
    },
    info: defaultStyle,
    warning: {
      bg: "bg-danger-soft",
      border: "border-danger-border",
      text: "text-danger-fg-strong",
      icon: <AlertTriangle className="w-4 h-4 text-danger-fg" />,
    },
    success: {
      bg: "bg-success-soft",
      border: "border-success-border",
      text: "text-success-fg-strong",
      icon: <CheckCircle2 className="w-4 h-4 text-success-fg" />,
    },
  }[type] || defaultStyle;

  return (
    <div className={`rounded-xl border p-4 ${styles.bg} ${styles.border}`}>
      <div className="flex gap-2.5 items-start">
        <div className="shrink-0 mt-0.5">{styles.icon}</div>
        <div className="space-y-1 text-xs">
          {title && (
            <h5 className={`font-semibold ${styles.text}`}>{title}</h5>
          )}
          <div className={`${styles.text} leading-relaxed opacity-90`}>
            {children || content}
          </div>
        </div>
      </div>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const InsightBoxDef = defineComponent({
  name: "InsightBox",
  description: "高亮展示关键分析结论、行动建议或异常警报",
  props: z.object({
    type: z.any().optional().describe("提示框类型"),
    title: z.any().optional().describe("提示标题"),
    content: z.any().optional().describe("提示详细内容与分析洞察"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const type = (["tip", "info", "warning", "success"].includes(String(props?.type)) ? props.type : "info") as "tip" | "info" | "warning" | "success";
    let title = props?.title ? String(props.title) : undefined;
    let content = props?.content ? String(props.content) : "";

    // 容错：如果只传了 2 个参数 InsightBox("tip", "长文本内容")
    if (!content && title) {
      content = title;
      title = undefined;
    }

    return (
      <ComponentSafeWrapper name="InsightBox">
        <InsightBox type={type} title={title} content={content} />
      </ComponentSafeWrapper>
    );
  },
});
