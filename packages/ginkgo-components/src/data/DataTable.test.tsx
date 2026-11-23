import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { DataTable } from "./DataTable";
import { emitFilterChange, resetFilterBus } from "../charts/filterBus";

afterEach(() => {
  cleanup();
  resetFilterBus();
});

describe("DataTable 数据表格", () => {
  const testData = [
    { id: 1, channel: "TikTok", deals: 120 },
    { id: 2, channel: "Google", deals: 200 },
    { id: 3, channel: "Bilibili", deals: 80 },
  ];

  it("正常渲染标题与列", () => {
    render(
      <DataTable
        title="明细数据表"
        columns={[
          { key: "channel", header: "渠道" },
          { key: "deals", header: "成交数" },
        ]}
        data={testData}
      />
    );
    expect(screen.getByText("明细数据表")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("响应 filterBus 筛选事件，动态切片表格行", () => {
    render(
      <DataTable
        title="明细表"
        columns={[
          { key: "channel", header: "渠道" },
          { key: "deals", header: "成交数" },
        ]}
        data={testData}
      />
    );
    expect(screen.getByText("TikTok")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Bilibili")).toBeInTheDocument();

    // 触发筛选：只看 Google
    act(() => {
      emitFilterChange({ field: "channel", value: "Google" });
    });
    expect(screen.queryByText("TikTok")).not.toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.queryByText("Bilibili")).not.toBeInTheDocument();

    // 清除筛选
    act(() => {
      emitFilterChange({ field: "channel", value: "" });
    });
    expect(screen.getByText("TikTok")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Bilibili")).toBeInTheDocument();
  });

  it("支持轻量分页：数据量超出 pageSize 时展示分页控制栏并按页切片", () => {
    const manyRows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      channel: `Channel_${i + 1}`,
      deals: 10 + i,
    }));

    render(
      <DataTable
        title="分页表"
        pageSize={10}
        columns={[
          { key: "channel", header: "渠道" },
          { key: "deals", header: "成交数" },
        ]}
        data={manyRows}
      />
    );

    // 第一页显示前 10 条
    expect(screen.getByText("Channel_1")).toBeInTheDocument();
    expect(screen.getByText("Channel_10")).toBeInTheDocument();
    expect(screen.queryByText("Channel_11")).not.toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByTitle("上一页")).toBeDisabled();
    expect(screen.getByTitle("下一页")).not.toBeDisabled();
  });

  it("初次挂载时能够直接继承并应用当前作用域已存在的筛选状态", () => {
    // 提前在总线中写入筛选条件
    emitFilterChange({ field: "channel", value: "Bilibili" });

    render(
      <DataTable
        title="继承筛选表"
        columns={[
          { key: "channel", header: "渠道" },
          { key: "deals", header: "成交数" },
        ]}
        data={testData}
      />
    );

    // 此时挂载的 DataTable 应直接依据初始状态过滤
    expect(screen.queryByText("TikTok")).not.toBeInTheDocument();
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
    expect(screen.getByText("Bilibili")).toBeInTheDocument();
  });
});
