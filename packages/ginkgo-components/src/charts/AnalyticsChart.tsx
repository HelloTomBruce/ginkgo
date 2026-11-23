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
import { onFilterChange, useDashboardScope } from "./filterBus";
import { SpecChart } from "./SpecChart";
import type { ChartSpec } from "@ginkgo/chart-spec";

// SeriesConfig 类型由 chartShared 统一导出（保持既有 import 路径兼容）
export type { SeriesConfig };

export interface AnalyticsChartProps {
  type?: "line" | "bar" | "area" | "pie";
  title?: string;
  description?: string;
  data?: Array<Record<string, unknown>>;
  xAxisKey?: string;
  series?: SeriesConfig[];
  height?: number;
  /** 可选声明式 ChartSpec：提供时自动委托给 SpecChart 走物化/服务端筛选 */
  spec?: Partial<ChartSpec> | string;
  table?: string;
}

const AnalyticsChartClassic: React.FC<AnalyticsChartProps> = ({
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

  // 响应式筛选联动（全图表响应 filterBus 广播）
  const [filterValues, setFilterValues] = React.useState<Record<string, string>>({});
  const scopeId = useDashboardScope();

  React.useEffect(() => {
    return onFilterChange((event) => {
      setFilterValues((prev) => {
        if (event.value === "") {
          const next = { ...prev };
          delete next[event.field];
          return next;
        }
        return { ...prev, [event.field]: event.value };
      });
    }, scopeId);
  }, [scopeId]);

  // 根据当前筛选状态对数据进行就地切片过滤（严格排他匹配，空值不穿透）
  const displayData = useMemo(() => {
    const filterKeys = Object.keys(filterValues);
    if (filterKeys.length === 0) return safeData;
    return safeData.filter((row) => {
      for (const key of filterKeys) {
        if (row[key] === undefined || row[key] === null) {
          return false;
        }
        if (String(row[key]) !== String(filterValues[key])) {
          return false;
        }
      }
      return true;
    });
  }, [safeData, filterValues]);

  // 系列解析 + 数值字段自动提取（共享 helper，见 chartShared）
  const safeSeries: SeriesConfig[] = useMemo(
    () => resolveSeries(series, displayData, xAxisKey),
    [series, displayData, xAxisKey]
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs min-w-0">
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
        {displayData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-foreground-faint">
            暂无图表数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={50}>
            {type === "line" ? (
              <LineChart data={displayData}>
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
              <BarChart data={displayData}>
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
              <AreaChart data={displayData}>
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
                  data={displayData}
                  dataKey={safeSeries[0]?.key || "value"}
                  nameKey={xAxisKey}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label
                >
                  {displayData.map((_: unknown, index: number) => (
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

export const AnalyticsChart: React.FC<AnalyticsChartProps> = (props) => {
  if (props.spec) {
    return (
      <SpecChart
        title={props.title}
        spec={props.spec}
        table={props.table}
        data={props.data}
        height={props.height}
      />
    );
  }
  return <AnalyticsChartClassic {...props} />;
};

// ===== UiSpec 组件库定义 =====
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
    queryId: z.any().optional().describe("可选的绑定查询 ID"),
    spec: z.any().optional().describe("可选的声明式 ChartSpec 规范"),
    table: z.any().optional().describe("可选的数据表名"),
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
          spec={props?.spec as AnalyticsChartProps["spec"]}
          table={props?.table ? String(props.table) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});
