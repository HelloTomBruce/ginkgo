import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Renderer } from "@openuidev/react-lang";
import { componentDemos } from "./componentDemos";
import { componentCatalog, analyticsLibrary, ErrorBoundary } from "./index";

/** 经生产渲染路径（<Renderer library/>）渲染单个 DSL 演示 */
function renderDemo(dsl: string) {
  return render(
    <ErrorBoundary name="componentDemos.test">
      <Renderer library={analyticsLibrary} response={dsl} isStreaming={false} />
    </ErrorBoundary>
  );
}

describe("componentDemos 组件演示样例", () => {
  it("每个演示 key 都对应目录中的组件名（防拼写漂移）", () => {
    const catalogNames = new Set(
      componentCatalog.flatMap((g) => g.components.map((c) => c.name))
    );
    for (const key of Object.keys(componentDemos)) {
      expect(catalogNames.has(key)).toBe(true);
    }
  });

  it("每个演示 DSL 均可经 Renderer 无错渲染（语法与 props 形态守护）", () => {
    const consoleError = console.error;
    console.error = () => {};
    try {
      for (const dsl of Object.values(componentDemos)) {
        const { unmount } = renderDemo(dsl);
        unmount();
      }
    } finally {
      console.error = consoleError;
    }
    // 循环体本身即断言：DSL 解析失败或组件抛错会让本用例失败
  });

  it("目录组件名全局唯一（CATALOG_GROUPS 重复登记会被派生进 library 两份）", () => {
    const names = componentCatalog.flatMap((g) => g.components.map((c) => c.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("目录中除 Root（DSL 根容器）外的主要展示组件均有演示", () => {
    const withoutDemo = componentCatalog
      .flatMap((g) => g.components.map((c) => c.name))
      .filter((name) => !componentDemos[name]);
    expect(withoutDemo).toEqual(["Root"]);
  });

  it("演示内容真实渲染（抽样断言 MetricCard 演示产出文案）", () => {
    renderDemo(componentDemos.MetricCard);
    expect(screen.getByText("月度 GMV")).toBeInTheDocument();
  });

  it("ReportLayout 报表演示渲染通过", () => {
    renderDemo(componentDemos.ReportLayout);
    expect(screen.getByText("电商月度经营报告")).toBeInTheDocument();
  });
});
