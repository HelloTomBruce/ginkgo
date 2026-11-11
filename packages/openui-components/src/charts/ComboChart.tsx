"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { parseArrayProp } from "../internal/parseProp";
import { CHART_COLORS } from "./chartShared";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";
import { calculateDualNiceScales } from "../internal/niceScale";

export interface ComboSeriesConfig {
  key: string;
  label?: string;
  type?: "bar" | "line";
  yAxis?: "left" | "right";
  color?: string;
  unit?: string;
}

export interface ComboChartProps {
  title?: string;
  description?: string;
  data: Array<Record<string, unknown>>;
  xAxisKey?: string;
  series: ComboSeriesConfig[];
  height?: number;
  leftAxisUnit?: string;
  rightAxisUnit?: string;
}

export const ComboChart: React.FC<ComboChartProps> = ({
  title,
  description,
  data = [],
  xAxisKey = "name",
  series = [],
  height = 300,
  leftAxisUnit,
  rightAxisUnit,
}) => {
  const safeData = useMemo(() => parseArrayProp(data), [data]);
  const safeSeries: ComboSeriesConfig[] = useMemo(() => {
    const rawList = parseArrayProp(series);
    if (rawList.length > 0) {
      return rawList.map((item, idx) => ({
        key: String(item.key ?? `series_${idx}`),
        label: item.label ? String(item.label) : undefined,
        type: (item.type === "line" ? "line" : "bar") as "bar" | "line",
        yAxis: (item.yAxis === "right" ? "right" : "left") as "left" | "right",
        color: item.color ? String(item.color) : undefined,
        unit: item.unit ? String(item.unit) : undefined,
      }));
    }
    // 自动推断
    if (safeData.length > 0 && typeof safeData[0] === "object") {
      const keys = Object.keys(safeData[0]).filter((k) => k !== xAxisKey);
      return keys.map((key, idx) => ({
        key,
        label: key,
        type: (idx === 0 ? "bar" : "line") as "bar" | "line",
        yAxis: (idx === 0 ? "left" : "right") as "left" | "right",
      }));
    }
    return [];
  }, [series, safeData, xAxisKey]);

  // 判断是否启用了右 Y 轴
  const hasRightAxis = useMemo(() => {
    return safeSeries.some((s) => s.yAxis === "right");
  }, [safeSeries]);

  // 双 Y 轴刻度归一与等分对齐（Nice Scales 算法）
  const { leftScale, rightScale } = useMemo(() => {
    if (safeData.length === 0) return { leftScale: null, rightScale: null };

    const leftKeys = safeSeries.filter((s) => s.yAxis !== "right").map((s) => s.key);
    const rightKeys = safeSeries.filter((s) => s.yAxis === "right").map((s) => s.key);

    const leftVals: number[] = [];
    const rightVals: number[] = [];

    for (const row of safeData) {
      for (const k of leftKeys) {
        const v = Number(row[k]);
        if (!isNaN(v)) leftVals.push(v);
      }
      for (const k of rightKeys) {
        const v = Number(row[k]);
        if (!isNaN(v)) rightVals.push(v);
      }
    }

    const { left, right } = calculateDualNiceScales(leftVals, rightVals, 5);
    return { leftScale: left, rightScale: right };
  }, [safeData, safeSeries]);

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-xs w-full">
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      )}

      <div style={{ width: "100%", height }}>
        {safeData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            暂无图表数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={safeData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.6} />
              <XAxis
                dataKey={xAxisKey}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--foreground-subtle)", fontSize: 11 }}
              />
              {/* 左 Y 轴（绝对量） */}
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--foreground-subtle)", fontSize: 11 }}
                unit={leftAxisUnit}
                domain={leftScale ? [leftScale.min, leftScale.max] : undefined}
                ticks={leftScale ? leftScale.ticks : undefined}
              />
              {/* 右 Y 轴（比率/次要量） */}
              {hasRightAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={{ fill: "var(--foreground-subtle)", fontSize: 11 }}
                  unit={rightAxisUnit}
                  domain={rightScale ? [rightScale.min, rightScale.max] : undefined}
                  ticks={rightScale ? rightScale.ticks : undefined}
                />
              )}
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  borderColor: "var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: "12px",
                  color: "var(--foreground)",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Legend
                wrapperStyle={{
                  paddingTop: "8px",
                  fontSize: "11px",
                  color: "var(--foreground-subtle)",
                }}
              />

              {safeSeries.map((s, idx) => {
                const color = s.color || CHART_COLORS[idx % CHART_COLORS.length];
                const yAxisId = s.yAxis === "right" ? "right" : "left";

                if (s.type === "line") {
                  return (
                    <Line
                      key={s.key}
                      yAxisId={yAxisId}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label || s.key}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 3, fill: color }}
                      activeDot={{ r: 5 }}
                    />
                  );
                }

                return (
                  <Bar
                    key={s.key}
                    yAxisId={yAxisId}
                    dataKey={s.key}
                    name={s.label || s.key}
                    fill={color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const ComboChartDef = defineComponent({
  name: "ComboChart",
  description:
    "双轴量率复合图：支持柱状图（绝对量，归属左Y轴）与折线图（比率/均值，归属右Y轴）同屏展示，适用于既要看总量又要看转化率或同比的复合场景",
  props: z.object({
    title: z.any().optional().describe("图表标题"),
    description: z.any().optional().describe("图表副标题或口径说明"),
    xAxisKey: z.any().optional().describe("X 轴对应的数据键名，缺省为 name"),
    data: z.any().describe("结构化图表数据数组"),
    series: z
      .any()
      .describe(
        "系列配置数组，每项指定 key, label, type ('bar'|'line'), yAxis ('left'|'right'), 可选 unit"
      ),
    height: z.any().optional().describe("图表高度，缺省 300"),
    leftAxisUnit: z.any().optional().describe("左 Y 轴单位，如 '万' 或 '元'"),
    rightAxisUnit: z.any().optional().describe("右 Y 轴单位，如 '%'"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = props?.title ? String(props.title) : undefined;
    const description = props?.description ? String(props.description) : undefined;
    const xAxisKey = props?.xAxisKey ? String(props.xAxisKey) : "name";
    const data = (props?.data as Array<Record<string, unknown>>) ?? [];
    const series = (props?.series as ComboSeriesConfig[]) ?? [];
    const height = props?.height ? Number(props.height) : 300;
    const leftAxisUnit = props?.leftAxisUnit ? String(props.leftAxisUnit) : undefined;
    const rightAxisUnit = props?.rightAxisUnit ? String(props.rightAxisUnit) : undefined;

    return (
      <ComponentSafeWrapper name="ComboChart">
        <ComboChart
          title={title}
          description={description}
          data={data}
          xAxisKey={xAxisKey}
          series={series}
          height={height}
          leftAxisUnit={leftAxisUnit}
          rightAxisUnit={rightAxisUnit}
        />
      </ComponentSafeWrapper>
    );
  },
});
