import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createSafeZone, renderSafeLayout } from "./layoutZone";

describe("layoutZone 模板插槽安全与 DRY 辅助工具", () => {
  it("空值与未定义安全短路为 null", () => {
    const renderNode = (n: unknown) => <div>{String(n)}</div>;
    const zone = createSafeZone(renderNode, "TestLayout");

    expect(zone(null)).toBeNull();
    expect(zone(undefined)).toBeNull();
  });

  it("正常节点正常通过 renderNode 渲染", () => {
    const renderNode = (n: unknown) => <div data-testid="child">{String(n)}</div>;
    const zone = createSafeZone(renderNode, "TestLayout");

    render(<div>{zone("hello", "kpis")}</div>);
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });

  it("renderNode 抛错时就地渲染插槽级异常卡，不静默吞错且不抛出", () => {
    const brokenRenderNode = () => {
      throw new Error("AST error");
    };
    const zone = createSafeZone(brokenRenderNode, "ReportLayout");

    render(<div>{zone(["broken"], "图表")}</div>);
    const fallback = screen.getByTestId("zone-error-fallback");
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveTextContent("ReportLayout 的「图表」区块解析失败");
  });

  it("renderSafeLayout 顶层防护捕获函数异常并渲染兜底", () => {
    const badFn = () => {
      throw new Error("Syntax Crash");
    };
    render(<div>{renderSafeLayout("BrokenLayout", badFn)}</div>);
    expect(screen.getByText(/BrokenLayout 模板加载异常/)).toBeInTheDocument();
  });
});
