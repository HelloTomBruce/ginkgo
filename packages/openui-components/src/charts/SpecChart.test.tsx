import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SpecChart } from "./SpecChart";
import { emitFilterChange } from "./filterBus";
import type { ChartSpec } from "@openui-analytics/chart-spec";

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

  it("fallback 类型（bar）沿用 AnalyticsChart 渲染", () => {
    const { container } = render(
      <SpecChart
        spec={{ ...spec, chartType: "bar" }}
        data={rows}
      />
    );
    expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
    expect(screen.getByText("容量")).toBeInTheDocument(); // 图例系列名
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
});
