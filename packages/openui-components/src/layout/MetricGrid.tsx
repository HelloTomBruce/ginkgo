import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";


export interface MetricGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}

export const MetricGrid: React.FC<MetricGridProps> = ({
  children,
  columns = 3,
}) => {
  // 列数只随【自身分得宽度】自适应，两处易错点缺一不可：
  // 1. 不能用视口断点（sm:/lg:）——桌面窗口恒宽，会把 3 列硬塞进 FocusLayout
  //    1/3 侧栏（约 300px）导致卡片挤作一团；
  // 2. @container 必须在外层 wrapper 上——元素不能容器查询自身，若与响应式类
  //    同处一个元素，@sm/@lg 会解析到祖先容器（如 FocusLayout 根，恒为宽），
  //    同样永远量不到自身真实宽度
  const colClass = {
    2: "grid-cols-1 @sm:grid-cols-2",
    3: "grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3",
    4: "grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-4",
  }[columns] || "grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3";

  return (
    <div className="@container w-full min-w-0">
      <div className={`grid gap-4 min-w-0 ${colClass}`}>{children}</div>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const MetricGridDef = defineComponent({
  name: "MetricGrid",
  description: "并排布局多个 MetricCard 指标卡的栅格容器",
  props: z.object({
    columns: z.any().optional().describe("网格列数或子组件列表"),
    children: z.any().optional().describe("子组件列表"),
  }),
  component: ({ props, renderNode }: { props: { columns?: unknown; children?: unknown }; renderNode?: (node?: unknown) => React.ReactNode }) => {
    let colNum: 2 | 3 | 4 = 3;
    let rawChildren = props?.children;

    if (Array.isArray(props?.columns)) {
      rawChildren = props.columns;
    } else if (typeof props?.columns === "number" && [2, 3, 4].includes(props.columns)) {
      colNum = props.columns as 2 | 3 | 4;
    }

    return (
      <ComponentSafeWrapper name="MetricGrid">
        <MetricGrid columns={colNum}>
          {renderNode ? renderNode(rawChildren) : null}
        </MetricGrid>
      </ComponentSafeWrapper>
    );
  },
});
