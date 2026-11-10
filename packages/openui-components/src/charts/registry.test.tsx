import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  getChartRenderer,
  chartRegistry,
  supportedChartTypes,
  normalizeRenderProps,
} from "./registry";
import { resolveSeries, CHART_COLORS, thresholdCellFill } from "./chartShared";

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

const renderPropsOf = (
  type: (typeof supportedChartTypes)[number],
  extra?: Partial<Parameters<NonNullable<ReturnType<typeof getChartRenderer>>["render"]>[0]>
) => {
  const entry = getChartRenderer(type);
  expect(entry).not.toBeNull();
  const base = normalizeRenderProps(rows, "channel", [
    { key: "deals", label: "成交数" },
    { key: "cvr", label: "转化率" },
  ]);
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

describe("图表注册表", () => {
  it("已注册类型（第二批含 scatter/gauge/heatmap）全部可用，未注册类型返回 null", () => {
    for (const t of supportedChartTypes) {
      expect(getChartRenderer(t)).not.toBeNull();
    }
    expect(chartRegistry.bar).toBeNull(); // bar 由 AnalyticsChart 兜底
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

  it("donut：单指标环形渲染（SVG 表面 + 扇区路径）", () => {
    const { entry, props } = renderPropsOf("donut");
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
    for (const t of supportedChartTypes) {
      const { entry, props } = renderPropsOf(t);
      if (t === "table") continue; // DataTable 自有空态文案
      const { unmount } = render(<entry.render {...props} rows={[]} />);
      expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
      unmount();
    }
  });

  it("各条目 zodSchema 校验合法入参通过、缺 measures 拒绝", () => {
    for (const t of supportedChartTypes) {
      const entry = getChartRenderer(t)!;
      expect(
        entry.zodSchema.safeParse({
          rows: [{ a: 1 }],
          dimField: "a",
          measures: [{ key: "a" }],
        }).success
      ).toBe(true);
      expect(entry.zodSchema.safeParse({ rows: [], dimField: "a", measures: [] }).success).toBe(
        false
      );
    }
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

  it("combo：辅助线 + 柱阈值着色并存", () => {
    const { entry, props } = renderPropsOf("combo");
    const { container } = render(
      <entry.render {...props} rows={styleRows} style={{ thresholds, referenceLines }} />
    );
    expect(container.querySelector(".recharts-reference-line")).toBeInTheDocument();
    expect(container.innerHTML).toContain("var(--danger-solid)");
  });

  it("table：阈值命中行单元格应用底色（cellStyle 钩子）", () => {
    const { entry, props } = renderPropsOf("table");
    render(<entry.render {...props} rows={styleRows} style={{ thresholds }} />);
    const cell = screen.getByText("50").closest("td");
    expect(cell).toHaveStyle({ backgroundColor: "var(--danger-solid)" });
    const okCell = screen.getByText("500").closest("td");
    expect(okCell?.getAttribute("style")).toBeNull();
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
    const props = normalizeRenderProps(scatterRows, "channel", twoMeasures);
    const { container } = render(<entry.render {...props} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-scatter-symbol").length).toBe(scatterRows.length);
  });

  it("gauge：current=首行首指标，target=首条辅助线", () => {
    const entry = getChartRenderer("gauge")!;
    const props = {
      ...normalizeRenderProps(
        [{ month: "M1", deals: 60 }],
        "month",
        [{ key: "deals", label: "成交数" }]
      ),
      style: { referenceLines: [{ value: 80, label: "目标" }] },
    };
    render(<entry.render {...props} />);
    // GaugeProgress：60/80 = 75%
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it("gauge：current 非数值 → 空态占位", () => {
    const entry = getChartRenderer("gauge")!;
    const props = normalizeRenderProps(
      [{ month: "M1", deals: "abc" }],
      "month",
      [{ key: "deals", label: "成交数" }]
    );
    render(<entry.render {...props} />);
    expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
  });

  it("heatmap：dimField→date、首指标→count 投影后复用 ContributionHeatmap", () => {
    const entry = getChartRenderer("heatmap")!;
    const props = normalizeRenderProps(
      [
        { day: "2026-11-01", commits: 3 },
        { day: "2026-11-02", commits: 7 },
      ],
      "day",
      [{ key: "commits", label: "提交数" }]
    );
    const { container } = render(<entry.render {...props} />);
    // 槽位日期在单元格 title 属性（悬浮提示）
    const cell = container.querySelector('[title^="2026-11-01"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("title")).toContain("3 次");
    // 累计值 = 3 + 7
    expect(screen.getByText("累计 10 次")).toBeInTheDocument();
  });
});
