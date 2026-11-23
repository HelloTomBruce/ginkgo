import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SpecChart } from "./SpecChart";
import { emitFilterChange } from "./filterBus";
import type { ChartSpec } from "@ginkgo/chart-spec";

// jsdom 下 recharts 需要显式尺寸才会渲染表面与图例（与 registry.test 同法）
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: (props: { children?: React.ReactElement }) =>
      props.children
        ? React.cloneElement(props.children, { width: 600, height: 280 } as never)
        : null,
  };
});

afterEach(cleanup);

const spec: ChartSpec = {
  dims: [{ field: "province" }],
  meas: [{ field: "capacity", agg: "sum", label: "容量" }],
  chartType: "donut",
  sourceId: "pg1",
};

const rows = [
  { province: "广东", capacity: 10 },
  { province: "江苏", capacity: 8 },
];

describe("SpecChart", () => {
  it("注册表类型（donut）渲染表面与扇区", () => {
    const { container } = render(<SpecChart title="各省容量" spec={spec} data={rows} />);
    expect(screen.getByText("各省容量")).toBeInTheDocument();
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });

  it("bar/line/area/pie 统一经注册表渲染（单卡片，无双层嵌套）", () => {
    for (const chartType of ["bar", "line", "area", "pie"] as const) {
      const { container, unmount } = render(
        <SpecChart spec={{ ...spec, chartType }} data={rows} />
      );
      expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
      // 卡片 chrome 仅壳层一层：AnalyticsChart 的 bg-card 卡片不再嵌套出现
      expect(container.querySelectorAll(".bg-card")).toHaveLength(1);
      unmount();
    }
  });

  it("data 缺省渲染空态占位", () => {
    render(<SpecChart spec={spec} />);
    expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
  });

  it("spec 形态非法渲染明确错误占位（不抛错）", () => {
    render(<SpecChart spec={{ dims: [], meas: [], chartType: "bar" }} data={rows} />);
    expect(screen.getByText(/ChartSpec.*无效/)).toBeInTheDocument();
  });

  it("spec 为 JSON 字符串时容错解析", () => {
    const { container } = render(
      <SpecChart spec={JSON.stringify(spec)} data={rows} />
    );
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });

  it("spec 为截断的未闭合 JSON 字符串时自动抢救并渲染", () => {
    // 模拟大模型生成到一半由于中断或 token 截断未闭合
    const truncated = '{"chartType":"bar","dims":[{"field":"province"}],"meas":[{"field":"capacity","agg":"sum"}],"data":[{"province":"广东","capacity":10';
    const { container } = render(<SpecChart spec={truncated} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });

  it("spec 字段为宽松格式（别名 chartType、字符串数组 dims/meas）时宽松解析", () => {
    const looseSpec = {
      chartType: "column", // 别名
      dims: ["province"], // 字符串数组
      meas: [{ field: "capacity" }], // 缺省 agg
      data: rows,
    };
    const { container } = render(<SpecChart spec={looseSpec as never} />);
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
  });

  it("父组件重渲染时，未传 data 或传字面量 data 不会触发 Too many re-renders 死循环", () => {
    function Parent() {
      const [, setTick] = React.useState(0);
      return (
        <div>
          <button onClick={() => setTick((t) => t + 1)}>rerender</button>
          <SpecChart spec={spec} />
          <SpecChart spec={spec} data={[{ province: "广东", capacity: 1 }]} />
        </div>
      );
    }
    render(<Parent />);
    const btn = screen.getByText("rerender");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByText("暂无图表数据")).toBeInTheDocument();
  });
});

describe("SpecChart 筛选联动（M2-4）", () => {
  const spec: ChartSpec = {
    dims: [{ field: "province" }],
    meas: [{ field: "capacity", agg: "sum" }],
    chartType: "table",
    sourceId: "pg1",
  };

  function stubFetch(capture: { body?: unknown }) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { body?: string }) => {
        if (typeof url === "string" && url.includes("preview-query")) {
          capture.body = JSON.parse(init?.body ?? "{}");
          return Promise.resolve({
            json: () =>
              Promise.resolve({ rows: [{ province: "广东", capacity: 42 }] }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({}) });
      }) as unknown as typeof fetch
    );
  }

  it("filterBus 广播命中维度字段 → POST preview-query 合并筛选 → data 更新", async () => {
    const captured: { body?: unknown } = {};
    stubFetch(captured);
    render(<SpecChart spec={spec} table="power_stats" data={[{ province: "广东", capacity: 1 }]} />);
    emitFilterChange({ field: "province", value: "江苏" });
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    const body = captured.body as { sourceId: string; table: string; spec: ChartSpec };
    expect(body.sourceId).toBe("pg1");
    expect(body.table).toBe("power_stats");
    const eq = body.spec.filters?.find((f) => f.field === "province");
    expect(eq).toMatchObject({ op: "eq", value: "江苏" });
  });

  it("字段不属于本图表 → 不发起 preview-query", async () => {
    const captured: { body?: unknown } = {};
    stubFetch(captured);
    render(<SpecChart spec={spec} table="power_stats" data={[{ province: "广东", capacity: 1 }]} />);
    emitFilterChange({ field: "region", value: "华东" });
    await new Promise((r) => setTimeout(r, 50));
    expect(captured.body).toBeUndefined();
    // 旧数据保留
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("「全部」（value=\"\"）清除该字段筛选：不再回填 eq 条件，重物化回退原数据", async () => {
    const bodies: Array<{ sourceId: string; table: string; spec: ChartSpec }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { body?: string }) => {
        if (typeof url === "string" && url.includes("preview-query")) {
          bodies.push(JSON.parse(init?.body ?? "{}"));
          // 第一次（筛选 江苏）返回单行；第二次（清除）返回全量两行
          const rowsResp =
            bodies.length === 1
              ? [{ province: "江苏", capacity: 42 }]
              : [
                  { province: "广东", capacity: 10 },
                  { province: "江苏", capacity: 8 },
                ];
          return Promise.resolve({ json: () => Promise.resolve({ rows: rowsResp }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({}) });
      }) as unknown as typeof fetch
    );
    render(
      <SpecChart spec={spec} table="power_stats" data={[{ province: "广东", capacity: 1 }]} />
    );

    emitFilterChange({ field: "province", value: "江苏" });
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(bodies[0].spec.filters).toEqual([
      { field: "province", op: "eq", value: "江苏" },
    ]);

    // 选择「全部」→ 移除该字段筛选，按剩余声明重物化
    emitFilterChange({ field: "province", value: "" });
    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].spec.filters ?? []).toEqual([]);
    // 旧筛选行（42）不再展示
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("data 引用变化（刷新回填新数组）→ filterState 失效，回退展示新 data", async () => {
    const captured: { body?: unknown } = {};
    stubFetch(captured);
    const initial = [{ province: "广东", capacity: 1 }];
    const { rerender } = render(
      <SpecChart spec={spec} table="power_stats" data={initial} />
    );

    // 筛选后展示回填的筛选行（42）
    emitFilterChange({ field: "province", value: "江苏" });
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    // dashboardRefresh 原地 mutate 后回填新数组（引用变化）：
    // 陈旧筛选行必须失效，回退展示新 data（9），否则用户看到旧数据集的筛选结果
    const refreshed = [{ province: "江苏", capacity: 9 }];
    rerender(<SpecChart spec={spec} table="power_stats" data={refreshed} />);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();

    // 同引用重渲染（普通父组件 state 更新）不应误伤有效筛选态
    rerender(<SpecChart spec={spec} table="power_stats" data={refreshed} />);
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("支持大模型将 data 和 table 内联在 spec 对象内，无需外层显式传 data", () => {
    const inlineSpec = {
      ...spec,
      table: "power_stats",
      data: [{ province: "浙江", capacity: 25 }],
    };
    render(<SpecChart spec={inlineSpec} />);
    expect(screen.queryByText("暂无图表数据")).not.toBeInTheDocument();
  });
});
