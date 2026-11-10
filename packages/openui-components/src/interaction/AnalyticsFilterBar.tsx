import React from "react";
import { useSetFieldValue, useTriggerAction, defineComponent } from "@openuidev/react-lang";
import { Filter, Play } from "lucide-react";
import { emitFilterChange } from "../charts/filterBus";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface FilterOption {
  label: string;
  value: string;
}

/** 声明模式：筛选选项来源（distinct 端点拉取），与 SpecChart 经 filterBus 联动 */
export interface FilterFieldSpec {
  sourceId: string;
  field: string;
  table: string;
  /** 展示名（缺省 = field） */
  label?: string;
}

export interface AnalyticsFilterBarProps {
  title?: string;
  channelOptions?: FilterOption[];
  metricOptions?: FilterOption[];
  defaultChannel?: string;
  defaultMetric?: string;
  /** 声明模式：提供后渲染单一数据驱动下拉（替代演示三控件），onChange 经 filterBus 广播 */
  filterField?: FilterFieldSpec;
  /** $filter.<name> 写入键名（缺省 = filterField.field） */
  filterName?: string;
}

/** 声明模式子组件：选项经 distinct 端点拉取 + $filter 写入 + filterBus 广播（hooks 归属本组件） */
const DeclarativeFilterBar: React.FC<{
  title: string;
  filterField: FilterFieldSpec;
  filterName?: string;
}> = ({ title, filterField, filterName }) => {
  const setFieldValue = useSetFieldValue();
  const [fetchedOptions, setFetchedOptions] = React.useState<FilterOption[]>([]);
  const [fetchNote, setFetchNote] = React.useState<string | null>(null);
  const [selectedValue, setSelectedValue] = React.useState<string>("");

  React.useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ field: filterField.field, table: filterField.table });
    fetch(`/api/datasources/${filterField.sourceId}/distinct?${qs}`)
      .then((r) => r.json())
      .then((body: { values?: string[]; note?: string; truncated?: boolean; error?: string }) => {
        if (cancelled) return;
        if (body.error) {
          setFetchNote(body.error);
          return;
        }
        const values = Array.isArray(body.values) ? body.values : [];
        if (values.length === 0 || body.truncated) {
          setFetchNote(
            body.note ?? (body.truncated ? "选项过多，请在输入框直接输入筛选值" : "该字段暂无可用选项")
          );
        }
        setFetchedOptions(values.map((v) => ({ label: v, value: v })));
      })
      .catch(() => {
        if (!cancelled) setFetchNote("筛选选项加载失败，可稍后重试");
      });
    return () => {
      cancelled = true;
    };
  }, [filterField.sourceId, filterField.field, filterField.table]);

  const handleDeclarativeChange = (val: string) => {
    setSelectedValue(val);
    const name = filterName || filterField.field;
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", `$filter.${name}`, val);
    }
    emitFilterChange({ field: filterField.field, value: val });
  };

  const displayName = filterField.label || filterField.field;
  return (
    <div className="bg-surface-sunken dark:bg-surface-inverse/80 border border-border rounded-xl p-4 shadow-xs">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-info-fg" />
        <h4 className="text-xs font-semibold text-foreground-strong">{title}</h4>
        <span className="text-[10px] bg-info-soft-strong text-info-fg px-2 py-0.5 rounded-full font-medium ms-auto">
          筛选联动
        </span>
      </div>
      <label className="block text-xs text-muted-foreground mb-1 font-medium">{displayName}</label>
      {fetchedOptions.length > 0 ? (
        <select
          value={selectedValue}
          onChange={(e) => handleDeclarativeChange(e.target.value)}
          className="w-full p-2 rounded-lg border border-border bg-card text-foreground-strong text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">全部</option>
          {fetchedOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={selectedValue}
          onChange={(e) => handleDeclarativeChange(e.target.value)}
          placeholder={fetchNote ?? "输入筛选值"}
          className="w-full p-2 rounded-lg border border-border bg-card text-foreground-strong text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
      {fetchNote && fetchedOptions.length > 0 && (
        <p className="text-[10px] text-foreground-faint mt-1">{fetchNote}</p>
      )}
    </div>
  );
};

/** 演示模式子组件：三控件表单 + 提交触发 AI 重算（hooks 归属本组件） */
const DemoFilterBar: React.FC<Omit<AnalyticsFilterBarProps, "filterField" | "filterName">> = ({
  title = "数据动态钻取与参数微调",
  channelOptions = [
    { label: "全部渠道", value: "all" },
    { label: "TikTok Ads", value: "TikTok Ads" },
    { label: "Google Search", value: "Google Search" },
    { label: "Meta Ads", value: "Meta Ads" },
    { label: "LinkedIn Ads", value: "LinkedIn Ads" },
  ],
  metricOptions = [
    { label: "获客成本 (CAC)", value: "cac" },
    { label: "获取线索量 (Leads)", value: "leads" },
    { label: "转化率 (CVR)", value: "cvr" },
    { label: "投资回报率 (ROI)", value: "roi" },
  ],
  defaultChannel = "all",
  defaultMetric = "cac",
}) => {
  const setFieldValue = useSetFieldValue();
  const triggerAction = useTriggerAction();

  let safeChannelOptions: FilterOption[] = Array.isArray(channelOptions) ? channelOptions : [];
  if (safeChannelOptions.length === 0) {
    safeChannelOptions = [
      { label: "全部渠道", value: "all" },
      { label: "TikTok Ads", value: "TikTok Ads" },
      { label: "Google Search", value: "Google Search" },
      { label: "Meta Ads", value: "Meta Ads" },
      { label: "LinkedIn Ads", value: "LinkedIn Ads" },
    ];
  }

  let safeMetricOptions: FilterOption[] = Array.isArray(metricOptions) ? metricOptions : [];
  if (safeMetricOptions.length === 0) {
    safeMetricOptions = [
      { label: "获客成本 (CAC)", value: "cac" },
      { label: "获取线索量 (Leads)", value: "leads" },
      { label: "转化率 (CVR)", value: "cvr" },
      { label: "投资回报率 (ROI)", value: "roi" },
    ];
  }

  const [selectedChannel, setSelectedChannel] = React.useState(defaultChannel);
  const [selectedMetric, setSelectedMetric] = React.useState(defaultMetric);
  const [targetBudget, setTargetBudget] = React.useState("50000");

  const handleChannelChange = (val: string) => {
    setSelectedChannel(val);
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", "channel", val);
    }
  };

  const handleMetricChange = (val: string) => {
    setSelectedMetric(val);
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", "metric", val);
    }
  };

  const handleBudgetChange = (val: string) => {
    setTargetBudget(val);
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", "budget", val);
    }
  };

  const handleSubmit = () => {
    const query = `【用户交互表单触发】请帮我针对渠道「${selectedChannel}」，核心指标聚焦于「${selectedMetric}」，在预算「$${targetBudget}」下进行重新计算、归因分析并刷新可视化看板。`;
    if (triggerAction) {
      triggerAction(query);
    }
  };

  return (
    <div className="bg-surface-sunken dark:bg-surface-inverse/80 border border-border rounded-xl p-4 shadow-xs">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-info-fg" />
        <h4 className="text-xs font-semibold text-foreground-strong">
          {title}
        </h4>
        <span className="text-[10px] bg-info-soft-strong text-info-fg px-2 py-0.5 rounded-full font-medium ms-auto">
          Interactive Form
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {/* 渠道筛选 */}
        <div>
          <label className="block text-muted-foreground mb-1 font-medium">
            聚焦推广渠道
          </label>
          <select
            value={selectedChannel}
            onChange={(e) => handleChannelChange(e.target.value)}
            className="w-full p-2 rounded-lg border border-border bg-card text-foreground-strong focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {safeChannelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 核心指标筛选 */}
        <div>
          <label className="block text-muted-foreground mb-1 font-medium">
            主分析维度
          </label>
          <select
            value={selectedMetric}
            onChange={(e) => handleMetricChange(e.target.value)}
            className="w-full p-2 rounded-lg border border-border bg-card text-foreground-strong focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {safeMetricOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 预算调整模拟 */}
        <div>
          <label className="block text-muted-foreground mb-1 font-medium">
            模拟总预算 ($)
          </label>
          <input
            type="number"
            value={targetBudget}
            onChange={(e) => handleBudgetChange(e.target.value)}
            placeholder="例如: 50000"
            className="w-full p-2 rounded-lg border border-border bg-card text-foreground-strong focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/60">
        <span className="text-[11px] text-foreground-faint">
          点击提交后，AI 将根据表单参数实时重新计算并生成对应图表看板
        </span>
        <button
          onClick={handleSubmit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-info-solid hover:bg-info-solid-hover text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>应用筛选并钻取</span>
        </button>
      </div>
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const AnalyticsFilterBarDef = defineComponent({
  name: "AnalyticsFilterBar",
  description: "供用户二次过滤渠道、切换指标维度、调整模拟预算并触发 AI 重新计算的交互式表单控件",
  props: z.object({
    title: z.any().optional().describe("表单标题"),
    defaultChannel: z.any().optional().describe("默认选中的渠道（演示模式）"),
    defaultMetric: z.any().optional().describe("默认选中的指标维度（演示模式）"),
    filterField: z.any().optional().describe("声明模式：{sourceId, field, table, label?}，选项经 distinct 端点拉取"),
    filterName: z.any().optional().describe("$filter.<name> 写入键名（缺省 = filterField.field）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="AnalyticsFilterBar">
        <AnalyticsFilterBar
          title={props?.title ? String(props.title) : undefined}
          defaultChannel={props?.defaultChannel ? String(props.defaultChannel) : undefined}
          defaultMetric={props?.defaultMetric ? String(props.defaultMetric) : undefined}
          filterField={props?.filterField as AnalyticsFilterBarProps["filterField"]}
          filterName={props?.filterName ? String(props.filterName) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});

/** 纯分发器：声明模式（filterField）→ DeclarativeFilterBar；否则演示模式 DemoFilterBar。
 *  本组件零 hooks——两种模式的 hooks 各自归属子组件，满足 rules-of-hooks。 */
export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = (props) => {
  const { filterField, filterName, ...demoProps } = props;
  if (filterField && typeof filterField.sourceId === "string" && typeof filterField.field === "string") {
    return (
      <DeclarativeFilterBar
        title={props.title ?? "筛选"}
        filterField={filterField}
        filterName={filterName}
      />
    );
  }
  return <DemoFilterBar {...demoProps} />;
};
