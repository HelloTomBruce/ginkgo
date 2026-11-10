/**
 * ChartSpec —— 统计图表的「维度/指标」语义契约（isomorphic，zod-only）。
 *
 * 借鉴 DataEase 数据 tab 的能力模型：图表 = 维度×指标×过滤 的声明，
 * 图形类型（chartType）是语义之上的可换渲染器——换图不换数据。
 *
 * 消费方：
 * - packages/openui-components（SpecChart 组件 + 注册表渲染器投影）
 * - packages/openui-llm（serverLibrary 下发 prompt schema，LLM 生成 ChartSpec）
 * - src/lib/specMaterialize（服务端物化：spec → 参数化 SQL / TransformSpec）
 *
 * 设计约束（与 docs/report-capability-design.md §4.1 对齐）：
 * - 词汇表全部封闭（枚举），无任意表达式注入面；compute 派生列走 transforms.ts
 * - 上限常量 CHART_SPEC_LIMITS 为唯一事实来源，src/lib/transforms.ts 的
 *   TRANSFORM_GROUP_BY_MAX / TRANSFORM_METRICS_MAX / TRANSFORM_LIMIT_MAX
 *   与之数值对齐（M1 收尾可改为从本包导入）
 * - sourceId 规则与 src/lib/dashboardStore.ts QUERY_SOURCE_ID_RE 同源
 */
import { z } from "zod";

// ===== 封闭词汇表 =====

/** 图形类型：可换渲染器（注册表 key，见 openui-components charts/registry.ts） */
export const CHART_TYPES = [
  "bar",
  "stacked-bar",
  "line",
  "area",
  "combo",
  "pie",
  "donut",
  "scatter",
  "gauge",
  "heatmap",
  "table",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** 聚合方式：与 src/lib/transforms.ts AggregateFn 同源 */
export const AGGREGATE_FNS = ["sum", "avg", "count", "min", "max"] as const;
export type AggregateFn = (typeof AGGREGATE_FNS)[number];

/** 过滤算子：封闭词汇表，物化侧逐 op 映射为参数化 SQL / 工具参数 */
export const FILTER_OPS = [
  "eq",
  "ne",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** 条件样式/辅助线可用色：语义色名 → 应用层 globals.css token，禁止裸色值 */
export const SEMANTIC_COLORS = ["success", "warning", "danger", "info"] as const;
export type SemanticColor = (typeof SEMANTIC_COLORS)[number];

/** 时间维度截断粒度 */
export const TIME_GRANULARITIES = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const;
export type TimeGranularity = (typeof TIME_GRANULARITIES)[number];

/** 指标数值格式 */
export const MEASURE_FORMATS = ["number", "percent", "currency", "compact"] as const;
export type MeasureFormat = (typeof MEASURE_FORMATS)[number];

// ===== 上限常量（唯一事实来源）=====

export const CHART_SPEC_LIMITS = {
  /** 维度数上限（= TRANSFORM_GROUP_BY_MAX） */
  dimsMax: 3,
  /** 指标数上限（= TRANSFORM_METRICS_MAX） */
  measMax: 12,
  /** 过滤条件数上限 */
  filtersMax: 8,
  /** 阈值规则数上限 */
  thresholdsMax: 4,
  /** 辅助线数上限 */
  referenceLinesMax: 3,
  /** 结果展示条数上限（= TRANSFORM_LIMIT_MAX） */
  limitMax: 10_000,
  /** 标题/标签文本长度上限 */
  labelMax: 60,
} as const;

// ===== 字段与标识符规则 =====

/** 数据源字段名：标识符形态（物化侧按源 schema 再校验存在性） */
export const FIELD_RE = /^[A-Za-z_$][\w$]{0,63}$/;
/** 数据源 id：与 dashboardStore QUERY_SOURCE_ID_RE 同源 */
export const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

const fieldSchema = z
  .string()
  .regex(FIELD_RE, "字段名须为标识符（字母/_/$ 开头，≤64 位字母数字_/$）");

// ===== 子结构 =====

const dimensionSchema = z.object({
  field: fieldSchema,
  label: z.string().max(CHART_SPEC_LIMITS.labelMax).optional(),
  /** 时间维度截断粒度（仅当字段为日期型时有意义，物化侧按方言实现） */
  granularity: z.enum(TIME_GRANULARITIES).optional(),
});

const measureSchema = z.object({
  field: fieldSchema,
  agg: z.enum(AGGREGATE_FNS),
  label: z.string().max(CHART_SPEC_LIMITS.labelMax).optional(),
  format: z.enum(MEASURE_FORMATS).optional(),
});

/** 过滤值：标量 / in 字符串数组 / between 数值二元组（与 op 配套，见 superRefine） */
const filterValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.tuple([z.number(), z.number()]),
]);

const filterSchema = z.object({
  field: fieldSchema,
  op: z.enum(FILTER_OPS),
  value: filterValueSchema,
});

const styleSchema = z.object({
  /** 条件样式：满足条件时按语义色着色（单元格/柱 cell/文本） */
  thresholds: z
    .array(
      z.object({
        when: z.object({
          field: fieldSchema,
          op: z.enum(["gt", "gte", "lt", "lte"]),
          value: z.number(),
        }),
        color: z.enum(SEMANTIC_COLORS),
      })
    )
    .max(CHART_SPEC_LIMITS.thresholdsMax)
    .optional(),
  /** 辅助线：均值/目标线（直角坐标类图渲染 ReferenceLine） */
  referenceLines: z
    .array(
      z.object({
        value: z.number(),
        label: z.string().max(20).optional(),
        color: z.enum(SEMANTIC_COLORS).optional(),
      })
    )
    .max(CHART_SPEC_LIMITS.referenceLinesMax)
    .optional(),
  showLegend: z.boolean().optional(),
  showLabel: z.boolean().optional(),
});

// ===== ChartSpec 主契约 =====

export const ChartSpecSchema = z
  .object({
    title: z.string().max(CHART_SPEC_LIMITS.labelMax).optional(),
    /** 维度桶：对应 DataEase「类别轴/钻取维度」＝ TransformSpec.groupBy */
    dims: z
      .array(dimensionSchema)
      .min(1)
      .max(CHART_SPEC_LIMITS.dimsMax),
    /** 指标桶：对应「值轴/指标(聚合方式)」 */
    meas: z
      .array(measureSchema)
      .min(1)
      .max(CHART_SPEC_LIMITS.measMax),
    /** 静态过滤声明（交互筛选在 M2 经 preview-query 合并后同构） */
    filters: z.array(filterSchema).max(CHART_SPEC_LIMITS.filtersMax).optional(),
    sort: z
      .object({ key: fieldSchema, desc: z.boolean().optional() })
      .optional(),
    /** 结果展示条数上限（物化时与引擎封顶取 min，缺省由物化侧决定） */
    limit: z.number().int().positive().max(CHART_SPEC_LIMITS.limitMax).optional(),
    /** 图形类型 = 可换渲染器 */
    chartType: z.enum(CHART_TYPES),
    style: styleSchema.optional(),
    /** 取数源；缺省 = 当前唯一激活源，多源场景必填（渲染侧提示） */
    sourceId: z.string().regex(SOURCE_ID_RE).optional(),
    /**
     * MCP 源取数声明（非 db 源必填）：物化退化路径先经此工具拉原始行，
     * 再按 dims/meas 聚合（TransformSpec 投影）+ filters 行级谓词过滤。
     * db 源忽略此字段（走参数化 SQL 直取）。
     */
    toolQuery: z
      .object({
        tool: z.string().regex(/^[A-Za-z_][\w.]{0,63}$/),
        args: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .superRefine((spec, ctx) => {
    // 饼/环仅支持单指标（渲染语义限制，提前在契约层拦截）
    if ((spec.chartType === "pie" || spec.chartType === "donut") && spec.meas.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["meas"],
        message: "pie/donut 仅支持单一指标（meas.length = 1）",
      });
    }
    // 散点要求恰好 2 个指标（X/Y 各一）
    if (spec.chartType === "scatter" && spec.meas.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["meas"],
        message: "scatter 需要恰好 2 个指标（X/Y 各一）",
      });
    }
    // op 与 value 形态配套
    (spec.filters ?? []).forEach((f, i) => {
      const path: (string | number)[] = ["filters", i, "value"];
      if (f.op === "between") {
        if (!Array.isArray(f.value) || f.value.length !== 2 || typeof f.value[0] !== "number") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: "between 的 value 须为 [number, number]",
          });
        }
        return;
      }
      if (f.op === "in") {
        if (
          !Array.isArray(f.value) ||
          f.value.length === 0 ||
          !f.value.every((v) => typeof v === "string")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: "in 的 value 须为非空字符串数组",
          });
        }
        return;
      }
      if (typeof f.value !== "string" && typeof f.value !== "number") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `${f.op} 的 value 须为标量（string | number）`,
        });
      }
    });
  });

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

// ===== 便捷函数 =====

/**
 * 安全解析：非法输入返回 null（不抛错）——LLM 生成链路容错惯例，
 * 与 dashboardStore「坏 JSON 静默跳过」哲学一致。
 */
export function parseChartSpec(input: unknown): ChartSpec | null {
  const result = ChartSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * ChartSpec → TransformSpec 投影所需的对齐视图（MCP 通道退化路径用）：
 * dims[].field → groupBy；meas field→agg → metrics。
 * 供 specMaterialize / dashboardRefresh 构造 TransformSpec，避免字段漂移。
 */
export function specToGroupByAndMetrics(spec: ChartSpec): {
  groupBy: string[];
  metrics: Record<string, AggregateFn>;
} {
  return {
    groupBy: spec.dims.map((d) => d.field),
    metrics: Object.fromEntries(spec.meas.map((m) => [m.field, m.agg])),
  };
}
