// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toActionableError } from "./actionableError";

describe("toActionableError 错误模式分类", () => {
  it("sqlGuard 只读拦截 → SQL_READONLY_VIOLATION", () => {
    const r = toActionableError("安全限制：仅允许执行只读 SELECT / WITH 查询！");
    expect(r.errorCode).toBe("SQL_READONLY_VIOLATION");
    expect(r.remediation).toContain("只读");
  });

  it("dbTools 前缀形态穿透识别（SQL 执行失败: 安全限制：…）", () => {
    const r = toActionableError("SQL 执行失败: 安全限制：检测到禁止的 SQL 指令 [DROP]");
    expect(r.errorCode).toBe("SQL_READONLY_VIOLATION");
  });

  it("EXPLAIN 纯代价类 → QUERY_TOO_EXPENSIVE；外壳内的根因（语法/表）优先归因", () => {
    // 外壳含根因「语法」→ 归语法错误（比笼统代价类更准）
    expect(toActionableError("SQL 执行计划语法预检失败: ...").errorCode).toBe(
      "SQL_SYNTAX_ERROR"
    );
    // 纯代价类（无表/列/语法关键词）
    expect(toActionableError("SQL 扫描数据行数超过单次查询预算，已触发熔断保护！").errorCode).toBe(
      "QUERY_TOO_EXPENSIVE"
    );
  });

  it("预检外壳内的表不存在穿透为 TABLE_NOT_FOUND（根因优先于外壳分类）", () => {
    const r = toActionableError(
      '执行计划预检失败（语法或表/字段不存在）：relation "nonexistent_t" does not exist'
    );
    expect(r.errorCode).toBe("TABLE_NOT_FOUND");
    expect(r.remediation).toContain("list_tables");
  });

  it("表不存在（dbTools 分支 + 各方言形态）→ TABLE_NOT_FOUND", () => {
    expect(toActionableError("未找到数据表: orders").errorCode).toBe("TABLE_NOT_FOUND");
    expect(toActionableError("SQL 执行失败: relation \"orders\" does not exist").errorCode).toBe(
      "TABLE_NOT_FOUND"
    );
    expect(toActionableError("no such table: orders").errorCode).toBe("TABLE_NOT_FOUND");
    expect(
      toActionableError("Table 'ginkgo.orders' doesn't exist").errorCode
    ).toBe("TABLE_NOT_FOUND");
  });

  it("列不存在 → COLUMN_NOT_FOUND（表/列混合报错时列优先于表判定）", () => {
    expect(toActionableError('column "cac" does not exist').errorCode).toBe("COLUMN_NOT_FOUND");
    expect(toActionableError("Unknown column 'cac' in 'field list'").errorCode).toBe(
      "COLUMN_NOT_FOUND"
    );
    expect(toActionableError("no such column: cac").errorCode).toBe("COLUMN_NOT_FOUND");
    expect(
      toActionableError('column "orders.cac" of relation "orders" does not exist').errorCode
    ).toBe("COLUMN_NOT_FOUND");
  });

  it("语法错误 → SQL_SYNTAX_ERROR", () => {
    expect(toActionableError("syntax error at or near \"FORM\"").errorCode).toBe(
      "SQL_SYNTAX_ERROR"
    );
  });

  it("超时 → QUERY_TIMEOUT", () => {
    expect(toActionableError("Query timed out after 5000ms").errorCode).toBe("QUERY_TIMEOUT");
    expect(toActionableError("SQL 执行失败: 查询超时").errorCode).toBe("QUERY_TIMEOUT");
  });

  it("连接失败 → SOURCE_UNAVAILABLE", () => {
    expect(toActionableError("connect ECONNREFUSED 127.0.0.1:5432").errorCode).toBe(
      "SOURCE_UNAVAILABLE"
    );
    expect(toActionableError("getaddrinfo ENOTFOUND db.example.com").errorCode).toBe(
      "SOURCE_UNAVAILABLE"
    );
  });

  it("未知错误走兜底 → TOOL_EXECUTION_FAILED", () => {
    const r = toActionableError("some weird driver crash");
    expect(r.errorCode).toBe("TOOL_EXECUTION_FAILED");
    expect(r.remediation).toContain("如实反馈");
  });
});
