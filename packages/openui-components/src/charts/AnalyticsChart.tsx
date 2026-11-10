"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { parseArrayProp } from "../internal/parseProp";
import { resolveSeries, CHART_COLORS, type SeriesConfig } from "./chartShared";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

// SeriesConfig 类型由 chartShared 统一导出（保持既有 import 路径兼容）
export type { SeriesConfig };

export interface AnalyticsChartProps {
  type: "line" | "bar" | "area" | "pie";
  title?: string;
  description?: string;
  data: Array<Record<string, unknown>>;
  xAxisKey?: string;
  series?: SeriesConfig[];
  height?: number;
}

export const AnalyticsChart: React.FC<AnalyticsChartProps> = ({
  type = "bar",
  title,
  description,
  data = [],
  xAxisKey = "name",
  series = [],
  height = 280,
}) => {
  // 安全容错：确保 data 与 series 始终为有效数组且元素为非空对象
  const safeData: Array<Record<string, unknown>> = useMemo(() => parseArrayProp(data), [data]);

  // 系列解析 + 数值字段自动提取（共享 helper，见 chartShared）
  const safeSeries: SeriesConfig[] = useMemo(
    () => resolveSeries(series, safeData, xAxisKey),
    [series, safeData, xAxisKey]
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      {title && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
      )}

      <div style={{ width: "100%", height, minHeight: height }}>
        {safeData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-foreground-faint">
            暂无图表数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={50}>
            {type === "line" ? (
              <LineChart data={safeData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {safeSeries.map((s, idx) => (
                  <Line
                    key={`line-${s.key || idx}`}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label || s.key}
                    stroke={s.color || CHART_COLORS[idx % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            ) : type === "bar" ? (
              <BarChart data={safeData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {safeSeries.map((s, idx) => (
                  <Bar
                    key={`bar-${s.key || idx}`}
                    dataKey={s.key}
                    name={s.label || s.key}
                    fill={s.color || CHART_COLORS[idx % CHART_COLORS.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            ) : type === "area" ? (
              <AreaChart data={safeData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {safeSeries.map((s, idx) => {
                  const color = s.color || CHART_COLORS[idx % CHART_COLORS.length];
                  return (
                    <Area
                      key={`area-${s.key || idx}`}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label || s.key}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.2}
                    />
                  );
                })}
              </AreaChart>
            ) : (
              <PieChart>
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Pie
                  data={safeData}
                  dataKey={safeSeries[0]?.key || "value"}
                  nameKey={xAxisKey}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label
                >
                  {safeData.map((_: unknown, index: number) => (
                    <Cell
                      key={`pie-cell-${index}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const AnalyticsChartDef = defineComponent({
  name: "AnalyticsChart",
  description: "多维数据可视化图表，支持折线图(line)、柱状图(bar)、面积图(area)和饼图(pie)",
  props: z.object({
    type: z.any().optional().describe("图表类型"),
    title: z.any().optional().describe("图表标题"),
    description: z.any().optional().describe("图表副标题或说明"),
    xAxisKey: z.any().optional().describe("X轴对应的数据键名"),
    data: z.any().optional().describe("结构化图表数据数组"),
    series: z.any().optional().describe("数据序列配置"),
    height: z.any().optional().describe("图表容器高度（像素）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const type = (["line", "bar", "area", "pie"].includes(String(props?.type)) ? props.type : "bar") as "line" | "bar" | "area" | "pie";
    const title = props?.title ? String(props.title) : undefined;
    const description = props?.description ? String(props.description) : undefined;
    const xAxisKey = props?.xAxisKey ? String(props.xAxisKey) : "name";
    const height = typeof props?.height === "number" ? props.height : 280;

    return (
      <ComponentSafeWrapper name="AnalyticsChart">
        <AnalyticsChart
          type={type}
          title={title}
          description={description}
          xAxisKey={xAxisKey}
          data={props?.data as Array<Record<string, unknown>>}
          series={props?.series as Array<{ key: string; label?: string; color?: string }>}
          height={height}
        />
      </ComponentSafeWrapper>
    );
  },
});
