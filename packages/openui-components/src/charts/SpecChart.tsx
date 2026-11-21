"use client";

import React from "react";
import { BarChart3 } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { parseChartSpec, type ChartSpec } from "@openui-analytics/chart-spec";
import { parseArrayProp } from "../internal/parseProp";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";
import { onFilterChange, useDashboardScope } from "./filterBus";
import { getChartRenderer } from "./registry";
import { tryRepairTruncatedJson, normalizeLooseSpec } from "./specTolerance";

/**
 * SpecChart —— 语义声明图表：LLM 输出「维度×指标×过滤」的 ChartSpec 而非渲染数据，
 * 图形类型是 spec.chartType 之上的可换渲染器（换图不换数据绑定）。
 *
 * 数据流：生成期 data 可由 LLM 物化填充（静态快照）；刷新期服务端按 spec
 * 物化（specMaterialize）回填 data——全程零 LLM。全部 chartType（含
 * bar/line/area/pie）统一走 registry 渲染器，卡片外框仅本壳层一层提供。
 */

export interface SpecChartProps {
  title?: string;
  /** ChartSpec：dims/meas/filters/chartType/style/sourceId（见 chart-spec 包契约） */
  spec: Partial<ChartSpec> | string;
  /** 数据表名（刷新物化用；静态渲染不需要） */
  table?: string;
  /** 已物化的行数组（生成期快照或刷新回填产物） */
  data?: Array<Record<string, unknown>>;
  height?: number;
  /**
   * 筛选联动重物化端点（组件包不感知宿主路由；缺省保留宿主现网路径以零变更，
   * 宿主/应用可显式传入自托管物化端点实现部署解耦）
   */
  materializeUrl?: string;
}

const EMPTY_DATA: Array<Record<string, unknown>> = [];

export const SpecChart: React.FC<SpecChartProps> = ({
  title,
  spec,
  // table 供刷新物化（dashboardRefresh）与筛选联动（preview-query）取数使用
  table,
  data = EMPTY_DATA,
  height = 280,
  materializeUrl = "/api/dashboards/preview-query",
}) => {
  // spec 可能是对象或 JSON 字符串（LLM 输出容错，与 parseArrayProp 同哲学）。
  // 按原始字符串形态 memo 解析结果：zod 解析（尤其内联 data 大数组）是热路径，
  // 且解析产物的引用稳定性是筛选联动 baseData 比对的前提——每渲染重建会让
  // effectiveData 引用漂移，inline-data 模式下筛选联动静默失效。
  const specRawKey = typeof spec === "string" ? spec : JSON.stringify(spec);
  const { parsedSpec, rawSpecObj } = React.useMemo(() => {
    let parsed: ChartSpec | null = null;
    let raw: Record<string, unknown> | null = null;
    try {
      if (typeof spec === "string") {
        const repaired = tryRepairTruncatedJson(spec) ?? spec;
        raw = JSON.parse(repaired);
      } else {
        raw = spec as Record<string, unknown>;
      }
      if (raw && typeof raw === "object") {
        const normalized = normalizeLooseSpec(raw);
        parsed = parseChartSpec(normalized);
        raw = normalized;
      } else {
        raw = null;
      }
    } catch {
      parsed = null;
      raw = typeof spec === "string" ? null : (spec as Record<string, unknown>);
    }
    return { parsedSpec: parsed, rawSpecObj: raw };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specRawKey]);

  // 兜底支持大模型将 table 和 data 内联写在 spec 对象内的常见形态
  const effectiveTable =
    table ||
    (typeof parsedSpec?.table === "string" ? parsedSpec.table : undefined) ||
    (typeof rawSpecObj?.table === "string" ? (rawSpecObj.table as string) : undefined);

  const effectiveData =
    data && Array.isArray(data) && data.length > 0
      ? data
      : Array.isArray(parsedSpec?.data) && parsedSpec.data.length > 0
        ? parsedSpec.data
        : Array.isArray(rawSpecObj?.data) && rawSpecObj.data.length > 0
          ? (rawSpecObj.data as Array<Record<string, unknown>>)
          : EMPTY_DATA;

  // ===== 筛选联动（M2-4）：订阅 filterBus，字段命中时自行重物化回填 =====
  // filterState: 记录用户筛选后的物化行与对应 baseData 引用及 specKey。
  // 基于引用比对做纯函数式派生，彻底消除 render 期调用 setState 的坏味道与重渲染死循环隐患。
  const specKey = React.useMemo(
    () => (parsedSpec ? JSON.stringify(parsedSpec) : ""),
    [parsedSpec]
  );
  const [filterState, setFilterState] = React.useState<{
    baseData: Array<Record<string, unknown>>;
    specKey: string;
    rows: Array<Record<string, unknown>>;
  } | null>(null);

  const dataRef = React.useRef(effectiveData);
  const specKeyRef = React.useRef(specKey);
  const scopeId = useDashboardScope();

  React.useEffect(() => {
    dataRef.current = effectiveData;
    specKeyRef.current = specKey;
  }, [effectiveData, specKey]);

  React.useEffect(() => {
    if (!parsedSpec || !effectiveTable) return;
    const owns = new Set<string>([
      ...parsedSpec.dims.map((d) => d.field),
      ...(parsedSpec.filters ?? []).map((f) => f.field),
    ]);
    let seq = 0; // 竞态守卫：快速连续筛选时仅最新请求可回填
    const off = onFilterChange((event) => {
      if (!owns.has(event.field)) return; // 声明式作用域：字段不属于本图表则不响应
      const rest = (parsedSpec.filters ?? []).filter((f) => f.field !== event.field);
      // 「全部」（value = ""）= 清除该字段筛选：不回填 eq 条件，按剩余声明重物化
      const merged: ChartSpec = {
        ...parsedSpec,
        filters:
          event.value === ""
            ? rest
            : [...rest, { field: event.field, op: "eq", value: event.value }],
      };
      const mySeq = ++seq;
      fetch(materializeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: merged.sourceId, table: effectiveTable, spec: merged }),
      })
        .then((r) => r.json())
        .then((body: { rows?: Array<Record<string, unknown>> }) => {
          if (mySeq !== seq) return; // 已有更新的筛选请求，丢弃过期响应
          if (Array.isArray(body.rows)) {
            setFilterState({
              baseData: dataRef.current,
              specKey: specKeyRef.current,
              rows: body.rows,
            });
          }
        })
        .catch(() => {
          // 联动失败静默保留旧数据（与刷新 stale 降级同哲学）
        });
    }, scopeId);
    return off;
    // specKey 稳定化：parsedSpec 对象每渲染重建，用序列化串做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, effectiveTable, scopeId, materializeUrl]);

  // 当 data 引用变化（dashboardRefresh 回填新数组）或 specKey 变化时，陈旧筛选行自然失效并展示最新 data
  const activeFilteredRows =
    filterState && filterState.baseData === effectiveData && filterState.specKey === specKey
      ? filterState.rows
      : null;
  const rows = parseArrayProp(activeFilteredRows ?? effectiveData);
  const chartType = parsedSpec?.chartType;

  const body = (() => {
    if (!parsedSpec || !chartType) {
      return (
        <div className="text-xs text-warning-fg bg-warning-soft rounded-lg px-3 py-2">
          图表声明（ChartSpec）无效，请重新生成
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div
          className="flex items-center justify-center text-xs text-foreground-faint"
          style={{ height, minHeight: height }}
        >
          暂无图表数据
        </div>
      );
    }

    // 统一经注册表派发（全枚举闭合，含 bar/line/area/pie）：维度/指标/样式一次投影，
    // 渲染器不带卡片外框，避免与壳层双层嵌套
    const entry = getChartRenderer(chartType);
    if (!entry) {
      // 防御分支：chart-spec 枚举与注册表应全量对齐，不应到达
      return (
        <div className="text-xs text-warning-fg bg-warning-soft rounded-lg px-3 py-2">
          图形类型 {chartType} 暂无渲染器
        </div>
      );
    }
    const Renderer = entry.render;
    return (
      <Renderer
        rows={rows}
        dimField={parsedSpec.dims[0]?.field || ""}
        dimFields={parsedSpec.dims.map((d) => ({ key: d.field, label: d.label }))}
        measures={parsedSpec.meas.map((m) => ({
          key: m.field,
          label: m.label || m.field,
          format: m.format,
        }))}
        height={height}
        style={{
          showLegend: parsedSpec.style?.showLegend,
          showLabel: parsedSpec.style?.showLabel,
          thresholds: parsedSpec.style?.thresholds,
          referenceLines: parsedSpec.style?.referenceLines,
        }}
      />
    );
  })();

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
      {(title || parsedSpec?.title) && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-info-fg shrink-0" />
            <span>{title || parsedSpec?.title}</span>
          </h3>
        </div>
      )}
      <ComponentSafeWrapper name="SpecChart">{body}</ComponentSafeWrapper>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const SpecChartDef = defineComponent({
  name: "SpecChart",
  description:
    "语义声明图表：声明维度/指标/过滤/图形类型（ChartSpec），数据由系统物化回填；支持换图不换数据（改 spec.chartType）",
  props: z.object({
    title: z.any().optional().describe("图表标题（缺省用 spec.title）"),
    spec: z.any().describe("ChartSpec 对象：dims/meas/chartType 必填，filters/sort/limit/style/sourceId 可选"),
    table: z.any().optional().describe("数据表名（刷新物化用）"),
    data: z.any().optional().describe("物化行数组（生成期快照或刷新回填）"),
    height: z.any().optional().describe("图表高度（像素）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = props?.title ? String(props.title) : undefined;
    const spec = props?.spec as SpecChartProps["spec"];
    let table = props?.table !== undefined ? props.table : undefined;
    const data = props?.data as Array<Record<string, unknown>> | undefined;
    let height = typeof props?.height === "number" ? props.height : undefined;

    // 容错：如果第三个位置 table 实际上是纯数字（LLM 误传 SpecChart(title, spec, height)）
    // 已知代价：真实表名恰好是纯数字且落在 50..2000 区间时会被误判为高度——
    // 该形态在业务库中极罕见，换取对 LLM 参数错位的健壮性。
    if (typeof table === "number" || (typeof table === "string" && /^\d+$/.test(String(table).trim()))) {
      const num = Number(table);
      if (num >= 50 && num <= 2000) {
        if (height === undefined) height = num;
        table = undefined;
      }
    }

    return (
      <SpecChart
        title={title}
        spec={spec}
        table={table ? String(table) : undefined}
        data={data}
        height={height ?? 280}
      />
    );
  },
});
