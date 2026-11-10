import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { getChartRenderer, chartRegistry, type RegistryRenderProps } from "./registry";
import {
  resolveSeries,
  formatMeasureValue,
  CHART_COLORS,
  thresholdCellFill,
} from "./chartShared";
import { CHART_TYPES, type ChartType } from "@openui-analytics/chart-spec";

// jsdom 下 ResponsiveContainer 尺寸为 0，recharts 不渲染图例/系列文本：
// 测试环境将其替换为固定尺寸直通容器（仅影响本文件，生产代码不变）
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: (props: { children?: React.ReactElement }) =>
      // 直通尺寸：图表组件需显式 width/height 才会渲染表面与图例
      props.children
        ? React.cloneElement(props.children, { width: 600, height: 280 } as never)
        : null,
  };
});

afterEach(cleanup);

const rows = [
  { channel: "TikTok Ads", deals: 186, cvr: 3.2 },
  { channel: "Google Ads", deals: 152, cvr: 4.1 },
  { channel: "线下展会", deals: 118, cvr: 2.5 },
];

const renderPropsOf = (type: ChartType, extra?: Partial<RegistryRenderProps>) => {
  const entry = getChartRenderer(type);
  expect(entry).not.toBeNull();
  const base: RegistryRenderProps = {
    rows,
    dimField: "channel",
    dimFields: [{ key: "channel" }],
    measures: [
      { key: "deals", label: "成交数" },
      { key: "cvr", label: "转化率" },
    ],
  };
  return { entry: entry!, props: { ...base, ...extra } };
};

describe("resolveSeries", () => {
  it("显式 series 过滤非法项", () => {
    const s = resolveSeries([{ key: "deals", label: "成交" }, { label: "坏数据" }, "junk"], rows, "channel");
    expect(s).toEqual([{ key: "deals", label: "成交" }]);
  });

  it("缺省时自动提取首行数值字段", () => {
    const s = resolveSeries([], rows, "channel");
    expect(s.map((x) => x.key)).toEqual(["deals", "cvr"]);
    expect(s[0].color).toBe(CHART_COLORS[0]);
  });

  it("全非数值列时退化为除 x 轴外全部列", () => {
    const textRows = [{ name: "a", tag: "x" }];
    const s = resolveSeries([], textRows, "name");
    expect(s.map((x) => x.key)).toEqual(["tag"]);
  });
});

describe("formatMeasureValue（meas[].format → Intl.NumberFormat）", () => {
  it("currency：缺省 CNY 货币样式", () => {
    expect(formatMeasureValue(1234.5, "currency")).toBe("¥1,234.50");
  });

  it("percent：值本身已是比率（0.156 → 16%）", () => {
    expect(formatMeasureValue(0.156, "percent")).toBe("16%");
  });

  it("compact：紧凑计数（12000 → 1.2万）", () => {
    expect(formatMeasureValue(12000, "compact")).toBe("1.2万");
  });

  it("number：千分位分组（1860 → 1,860）", () => {
    expect(formatMeasureValue(1860, "number")).toBe("1,860");
  });

  it("空值与非数值容错（回退 - / 原样字符串化）", () => {
    expect(formatMeasureValue(null, "currency")).toBe("-");
    expect(formatMeasureValue(undefined, "percent")).toBe("-");
    expect(formatMeasureValue("abc", "compact")).toBe("abc");
  });
});

describe("图表注册表", () => {
  it("全枚举闭合：CHART_TYPES 11 个类型全部注册可用", () => {
    expect(CHART_TYPES.length).toBe(11);
    for (const t of CHART_TYPES) {
      expect(getChartRenderer(t)).not.toBeNull();
      expect(chartRegistry[t]).not.toBeNull();
    }
  });

  it("stacked-bar：图例展示两个指标名", () => {
    const { entry, props } = renderPropsOf("stacked-bar");
    render(<entry.render {...props} />);
    expect(screen.getByText("成交数")).toBeInTheDocument();
    expect(screen.getByText("转化率")).toBeInTheDocument();
  });

  it("combo：约定末位指标为折线（图例含折线系列名）", () => {
    const { entry, props } = renderPropsOf("combo");
    render(<entry.render {...props} />);
    expect(screen.getByText("成交数")).toBeInTheDocument();
    expect(screen.getByText("转化率")).toBeInTheDocument();
  });

  it("bar：分组柱渲染（SVG 表面 + 柱矩形 + 图例系列名）", () => {
    const { entry, props } = renderPropsOf("bar");
    const { container } = render(<entry.render {...props} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
    expect(screen.getByText("成交数")).toBeInTheDocument();
  });

  it("line：折线渲染（SVG 表面 + 折线路径）", () => {
    const { entry, props } = renderPropsOf("line");
    const { container } = render(<entry.render {...props} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    // 两个指标 → 两条折线路径
    expect(container.querySelectorAll(".recharts-line-curve").length).toBe(2);
  });

  it("area：面积渲染（SVG 表面 + 面积路径）", () => {
    const { entry, props } = renderPropsOf("area");
    const { container } = render(<entry.render {...props} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-area-area").length).toBe(2);
  });

  it("pie：单指标实心饼渲染（SVG 表面 + 扇区路径）", () => {
    const { entry, props } = renderPropsOf("pie", {
      measures: [{ key: "deals", label: "成交数" }],
    });
    const { container } = render(<entry.render {...props} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-surface path").length).toBeGreaterThanOrEqual(
      rows.length
    );
  });

  it("donut：单指标环形渲染（SVG 表面 + 扇区路径）", () => {
    const { entry, props } = renderPropsOf("donut", {
      measures: [{ key: "deals", label: "成交数" }],
    });
    const { container } = render(<entry.render {...props} />);
    // jsdom 中 recharts 图例文本渲染不稳定，改以结构断言验证渲染路径
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    // 扇区以 path 元素渲染（recharts 3 的 sector 类名与 v2 不同，按 path 数量断言）
    expect(container.querySelectorAll(".recharts-surface path").length).toBeGreaterThanOrEqual(
      rows.length
    );
  });

  it("table：DataTable 投影（维度列 + 指标列）", () => {
    const { entry, props } = renderPropsOf("table");
    render(<entry.render {...props} />);
    expect(screen.getByText("channel")).toBeInTheDocument();
    expect(screen.getByText("成交数")).toBeInTheDocument();
    expect(screen.getByText("转化率")).toBeInTheDocument();
    expect(screen.getByText("TikTok Ads")).toBeInTheDocument();
  });

  it("空行数据渲染空态占位（不抛错）", () => {
    for (const t of CHART_TYPES) {
      const { entry, props } = renderPropsOf(t);
      if (t === "table") continue; // DataTable 自有空态文案
      const { unmount } = render(<entry.render {...props} rows={[]} />);
      expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("table 全维度列与指标格式化（R8）", () => {
  const multiDimRows = [
    { province: "广东", city: "深圳", deals: 186 },
    { province: "江苏", city: "苏州", deals: 118 },
  ];

  function renderTable(extra?: Partial<RegistryRenderProps>) {
    const entry = getChartRenderer("table")!;
    const props: RegistryRenderProps = {
      rows: multiDimRows,
      dimField: "province",
      dimFields: [
        { key: "province", label: "省份" },
        { key: "city", label: "城市" },
      ],
      measures: [{ key: "deals", label: "成交数" }],
      ...extra,
    };
    return render(<entry.render {...props} />);
  }

  it("多维度全部渲染为列（不再丢弃 dims[1..]），label 缺省回退字段名", () => {
    renderTable();
    expect(screen.getByText("省份")).toBeInTheDocument();
    expect(screen.getByText("城市")).toBeInTheDocument();
    expect(screen.getByText("深圳")).toBeInTheDocument();
    expect(screen.getByText("苏州")).toBeInTheDocument();
  });

  it("dimFields 缺省时回退 dimField 单列", () => {
    const entry = getChartRenderer("table")!;
    render(
      <entry.render
        rows={multiDimRows}
        dimField="province"
        dimFields={[]}
        measures={[{ key: "deals" }]}
      />
    );
    expect(screen.getByText("province")).toBeInTheDocument();
    expect(screen.queryByText("city")).not.toBeInTheDocument();
  });

  it("format=currency：单元格渲染 ¥ 货币（缺省 CNY）", () => {
    renderTable({ measures: [{ key: "deals", label: "成交金额", format: "currency" }] });
    expect(screen.getByText("¥186.00")).toBeInTheDocument();
    expect(screen.getByText("¥118.00")).toBeInTheDocument();
  });

  it("format=percent：比率值按百分比渲染", () => {
    renderTable({
      rows: [{ channel: "A", cvr: 0.156 }],
      dimField: "channel",
      dimFields: [{ key: "channel" }],
      measures: [{ key: "cvr", label: "转化率", format: "percent" }],
    });
    expect(screen.getByText("16%")).toBeInTheDocument();
  });

  it("format=compact：大数紧凑渲染", () => {
    renderTable({
      rows: [{ channel: "A", leads: 12000 }],
      dimField: "channel",
      dimFields: [{ key: "channel" }],
      measures: [{ key: "leads", label: "线索量", format: "compact" }],
    });
    expect(screen.getByText("1.2万")).toBeInTheDocument();
  });

  it("format=number：千分位渲染", () => {
    renderTable({
      rows: [{ channel: "A", deals: 1860 }],
      dimField: "channel",
      dimFields: [{ key: "channel" }],
      measures: [{ key: "deals", label: "成交数", format: "number" }],
    });
    expect(screen.getByText("1,860")).toBeInTheDocument();
  });

  it("未声明 format：保持原始值展示（不引入行为漂移）", () => {
    renderTable({ measures: [{ key: "deals", label: "成交数" }] });
    expect(screen.getByText("186")).toBeInTheDocument();
  });
});

describe("条件样式与辅助线（M2-2）", () => {
  const styleRows = [
    { channel: "A", deals: 500 },
    { channel: "B", deals: 50 }, // 低于阈值
    { channel: "C", deals: 900 },
  ];
  const thresholds = [
    { when: { field: "deals", op: "lt" as const, value: 100 }, color: "danger" as const },
  ];
  const referenceLines = [{ value: 300, label: "目标线", color: "success" as const }];

  it("阈值命中行返回语义色 token，未命中 undefined", () => {
    expect(thresholdCellFill(styleRows[0], thresholds)).toBeUndefined();
    expect(thresholdCellFill(styleRows[1], thresholds)).toBe("var(--danger-solid)");
    expect(thresholdCellFill(styleRows[1], undefined)).toBeUndefined();
  });

  it("stacked-bar：辅助线渲染 ReferenceLine（recharts-surface 内）", () => {
    const { entry } = renderPropsOf("stacked-bar");
    const { container } = render(
      <entry.render
        {...renderPropsOf("stacked-bar").props}
        rows={styleRows}
        style={{ thresholds, referenceLines }}
      />
    );
    expect(container.querySelector(".recharts-reference-line")).toBeInTheDocument();
    // 阈值命中行的 Cell fill 覆盖基础色
    expect(container.innerHTML).toContain("var(--danger-solid)");
  });

  it("bar：辅助线 + 阈值柱着色（注册表新渲染器与 stacked-bar 同构）", () => {
    const { entry } = renderPropsOf("bar");
    const { container } = render(
      <entry.render
        {...renderPropsOf("bar").props}
        rows={styleRows}
        measures={[{ key: "deals", label: "成交数" }]}
        style={{ thresholds, referenceLines }}
      />
    );
    expect(container.querySelector(".recharts-reference-line")).toBeInTheDocument();
    expect(container.innerHTML).toContain("var(--danger-solid)");
  });

  it("combo：辅助线 + 柱阈值着色并存", () => {
    const { entry, props } = renderPropsOf("combo");
    const { container } = render(
      <entry.render {...props} rows={styleRows} style={{ thresholds, referenceLines }} />
    );
    expect(container.querySelector(".recharts-reference-line")).toBeInTheDocument();
    expect(container.innerHTML).toContain("var(--danger-solid)");
  });

  it("table：阈值命中行单元格应用底色（cellStyle 钩子，原始行数值判定）", () => {
    const { entry, props } = renderPropsOf("table");
    render(<entry.render {...props} rows={styleRows} style={{ thresholds }} />);
    const cell = screen.getByText("50").closest("td");
    expect(cell).toHaveStyle({ backgroundColor: "var(--danger-solid)" });
    const okCell = screen.getByText("500").closest("td");
    expect(okCell?.getAttribute("style")).toBeNull();
  });

  it("table：格式化后阈值判定仍按原始数值（格式化串不参与比较）", () => {
    const entry = getChartRenderer("table")!;
    const spendThresholds = [
      { when: { field: "spend", op: "lt" as const, value: 100 }, color: "danger" as const },
    ];
    render(
      <entry.render
        rows={[{ channel: "A", spend: 50 }, { channel: "B", spend: 500 }]}
        dimField="channel"
        dimFields={[{ key: "channel" }]}
        measures={[{ key: "spend", label: "花费", format: "currency" }]}
        style={{ thresholds: spendThresholds }}
      />
    );
    // 50 → "¥50.00"（命中阈值着色）；500 → "¥500.00"（未命中）
    expect(screen.getByText("¥50.00").closest("td")).toHaveStyle({
      backgroundColor: "var(--danger-solid)",
    });
    expect(screen.getByText("¥500.00").closest("td")?.getAttribute("style")).toBeNull();
  });
});

describe("注册表第二批（M3-2）：scatter / gauge / heatmap", () => {
  const scatterRows = [
    { channel: "A", spend: 100, cvr: 3.2 },
    { channel: "B", spend: 200, cvr: 4.1 },
    { channel: "C", spend: 150, cvr: 2.5 },
  ];
  const twoMeasures = [
    { key: "spend", label: "花费" },
    { key: "cvr", label: "转化率" },
  ];

  it("scatter：双指标散点渲染（SVG 表面 + 散点符号）", () => {
    const entry = getChartRenderer("scatter")!;
    const props: RegistryRenderProps = {
      rows: scatterRows,
      dimField: "channel",
      dimFields: [{ key: "channel" }],
      measures: twoMeasures,
    };
    const { container } = render(<entry.render {...props} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-scatter-symbol").length).toBe(scatterRows.length);
  });

  it("gauge：current=首行首指标，target=首条辅助线", () => {
    const entry = getChartRenderer("gauge")!;
    const props: RegistryRenderProps = {
      rows: [{ month: "M1", deals: 60 }],
      dimField: "month",
      dimFields: [{ key: "month" }],
      measures: [{ key: "deals", label: "成交数" }],
      style: { referenceLines: [{ value: 80, label: "目标" }] },
    };
    render(<entry.render {...props} />);
    // GaugeProgress：60/80 = 75%
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it("gauge：current 非数值 → 空态占位", () => {
    const entry = getChartRenderer("gauge")!;
    const props: RegistryRenderProps = {
      rows: [{ month: "M1", deals: "abc" }],
      dimField: "month",
      dimFields: [{ key: "month" }],
      measures: [{ key: "deals", label: "成交数" }],
    };
    render(<entry.render {...props} />);
    expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
  });

  it("heatmap：dimField→date、首指标→count 投影后复用 ContributionHeatmap", () => {
    const entry = getChartRenderer("heatmap")!;
    const props: RegistryRenderProps = {
      rows: [
        { day: "2026-11-01", commits: 3 },
        { day: "2026-11-02", commits: 7 },
      ],
      dimField: "day",
      dimFields: [{ key: "day" }],
      measures: [{ key: "commits", label: "提交数" }],
    };
    const { container } = render(<entry.render {...props} />);
    // 槽位日期在单元格 title 属性（悬浮提示）
    const cell = container.querySelector('[title^="2026-11-01"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("title")).toContain("3 次");
    // 累计值 = 3 + 7
    expect(screen.getByText("累计 10 次")).toBeInTheDocument();
  });
});
