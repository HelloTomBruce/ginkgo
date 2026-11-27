// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ComponentCatalogModal } from "./ComponentCatalogModal";
import { componentCatalog, componentDemos } from "@ginkgolab/components";

const FLAT_NAMES = componentCatalog.flatMap((g) => g.components.map((c) => c.name));

function renderModal(overrides?: Partial<Parameters<typeof ComponentCatalogModal>[0]>) {
  const props = { open: true, onClose: vi.fn(), ...overrides };
  render(<ComponentCatalogModal {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("ComponentCatalogModal 可视化组件查看（主从布局）", () => {
  it("左栏按分类列出全部组件，头部统计分类与组件数", () => {
    renderModal();

    for (const group of componentCatalog) {
      expect(screen.getByText(group.category)).toBeInTheDocument();
    }
    const total = FLAT_NAMES.length;
    expect(
      screen.getByText(`${componentCatalog.length} 个分类 · ${total} 个组件`)
    ).toBeInTheDocument();
  });

  it("默认选中第一个带演示的组件并展示其实况预览", () => {
    renderModal();

    const firstDemoName = FLAT_NAMES.find((n) => componentDemos[n]);
    expect(firstDemoName).toBeDefined();
    // 详情区名称徽章 + 选中按钮同时存在（各 1 处）
    expect(screen.getAllByText(firstDemoName!).length).toBeGreaterThanOrEqual(2);
    // MetricGrid 演示文案（默认选中即 MetricGrid）
    expect(screen.getByText("月度 GMV")).toBeInTheDocument();
  });

  it("点击左栏条目切换右侧详情与预览", () => {
    renderModal();

    // 切到 FunnelChart：预览出现漏斗阶段文案
    fireEvent.click(screen.getByRole("button", { name: "FunnelChart" }));
    expect(screen.getByText("投放转化漏斗")).toBeInTheDocument();

    // 切到 DataTable：预览出现表格标题
    fireEvent.click(screen.getByRole("button", { name: "DataTable" }));
    expect(screen.getByText("渠道明细")).toBeInTheDocument();

    // 切到 ComboChart：预览出现双轴图标题
    fireEvent.click(screen.getByRole("button", { name: "ComboChart" }));
    expect(screen.getByText("月度销售额与转化率")).toBeInTheDocument();

    // 切到 RankingList：预览出现排行榜标题
    fireEvent.click(screen.getByRole("button", { name: "RankingList" }));
    expect(screen.getByText("获客渠道 Top 5")).toBeInTheDocument();
  });

  it("SpecChart 条目显示图表类型 chips（派生自 CHART_TYPES）", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "SpecChart" }));
    expect(screen.getByText("11 种图表类型")).toBeInTheDocument();
    for (const t of ["bar", "stacked-bar", "line", "area", "combo", "pie", "donut", "scatter", "gauge", "heatmap", "table"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("Root 无演示：显示占位说明而非空预览区", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    expect(screen.getByText(/DSL 根容器/)).toBeInTheDocument();
  });

  it("分类头可折叠：点击隐藏/再展开该组组件，计数徽标常显", () => {
    renderModal();

    // 初始全展开：图表组组件可见
    expect(screen.getByRole("button", { name: "FunnelChart" })).toBeInTheDocument();

    // 折叠「图表」组：组内组件按钮消失，分类头与计数仍在
    fireEvent.click(screen.getByRole("button", { name: /图表/ }));
    expect(screen.queryByRole("button", { name: "FunnelChart" })).toBeNull();
    expect(screen.getByRole("button", { name: /图表/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    // 其他组不受影响
    expect(screen.getByRole("button", { name: "MetricCard" })).toBeInTheDocument();

    // 再次点击展开
    fireEvent.click(screen.getByRole("button", { name: /图表/ }));
    expect(screen.getByRole("button", { name: "FunnelChart" })).toBeInTheDocument();
  });

  it("open=false 时不渲染内容", () => {
    renderModal({ open: false });
    expect(screen.queryByText("可视化组件")).toBeNull();
  });
});
