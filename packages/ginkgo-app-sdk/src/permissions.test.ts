import { describe, it, expect } from "vitest";
import {
  APP_PERMISSION_LABELS,
  describeAppPermission,
  diffUnacknowledgedPermissions,
  filterToolsByPermission,
} from "./permissions";

/**
 * 权限模型 v1 的两条硬承诺：
 *   1. 未声明 permissions 的内置应用**不受影响**（零回归）；
 *   2. 声明了 permissions 的应用走 default deny —— 未映射的工具被丢弃。
 */
describe("filterToolsByPermission 权限门禁", () => {
  const tools = {
    sql_query: { name: "sql_query" },
    export_csv: { name: "export_csv" },
    mystery_tool: { name: "mystery_tool" },
  };

  it("未声明 permissions（内置/受信应用）时原样放行", () => {
    const { tools: kept, stripped } = filterToolsByPermission(
      { id: "analytics" },
      undefined,
      tools
    );
    expect(Object.keys(kept)).toEqual([
      "sql_query",
      "export_csv",
      "mystery_tool",
    ]);
    expect(stripped).toEqual({});
  });

  it("已声明 permissions 时按 toolPermissions 白名单放行", () => {
    const { tools: kept, stripped } = filterToolsByPermission(
      { id: "third", permissions: ["datasources.read"] },
      {
        sql_query: "datasources.read",
        export_csv: "workspace.write",
      },
      tools
    );

    // 只有被授予权限且已声明的工具放行
    expect(Object.keys(kept)).toEqual(["sql_query"]);
    expect(stripped.export_csv).toContain("缺少权限 workspace.write");
  });

  it("未在 toolPermissions 中声明的工具被丢弃（default deny）", () => {
    const { tools: kept, stripped } = filterToolsByPermission(
      { id: "third", permissions: ["datasources.read"] },
      { sql_query: "datasources.read" },
      tools
    );

    expect(kept.mystery_tool).toBeUndefined();
    expect(stripped.mystery_tool).toContain("default deny");
  });

  it("声明了 permissions 但完全没有 toolPermissions 时全部丢弃", () => {
    const { tools: kept } = filterToolsByPermission(
      { id: "third", permissions: ["datasources.read"] },
      undefined,
      tools
    );
    expect(kept).toEqual({});
  });

  it("空权限清单（[]）视为已声明：仍然 default deny", () => {
    const { tools: kept } = filterToolsByPermission(
      { id: "third", permissions: [] },
      { sql_query: "datasources.read" },
      tools
    );
    expect(kept).toEqual({});
  });
});

describe("安装握手：未确认权限差集", () => {
  it("包未声明权限时无需确认", () => {
    expect(diffUnacknowledgedPermissions(undefined, undefined)).toEqual([]);
    expect(diffUnacknowledgedPermissions([], [])).toEqual([]);
  });

  it("返回声明但未确认的权限", () => {
    expect(
      diffUnacknowledgedPermissions(
        ["datasources.read", "shell.execute"],
        ["datasources.read"]
      )
    ).toEqual(["shell.execute"]);
  });

  it("全部确认后差集为空", () => {
    expect(
      diffUnacknowledgedPermissions(["shell.execute"], ["shell.execute"])
    ).toEqual([]);
  });
});

describe("权限展示名", () => {
  it("已知权限有中文说明，未知权限有兜底文案", () => {
    expect(describeAppPermission("shell.execute")).toContain("shell");
    expect(describeAppPermission("quantum.read")).toContain("未知权限");
    expect(Object.keys(APP_PERMISSION_LABELS)).toHaveLength(5);
  });
});
