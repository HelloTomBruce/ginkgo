import { describe, it, expect } from "vitest";
import { toolFailure, isToolFailureLike } from "./toolResult";

describe("toolFailure 工厂", () => {
  it("带工具名时以 [name] 前缀注入 error", () => {
    expect(toolFailure("browser_open", "boom")).toEqual({
      success: false,
      error: "[browser_open] boom",
      isError: true,
    });
  });

  it("不带工具名时 error 保持原样", () => {
    expect(toolFailure(null, "boom")).toEqual({
      success: false,
      error: "boom",
      isError: true,
    });
    expect(toolFailure(undefined, "boom").error).toBe("boom");
  });
});

describe("isToolFailureLike 宽容守卫", () => {
  it("识别规范失败形状与历史旧形状", () => {
    expect(isToolFailureLike(toolFailure("t", "x"))).toBe(true);
    expect(isToolFailureLike({ error: "any error" })).toBe(true);
    expect(isToolFailureLike({ success: false, exitCode: 1 })).toBe(true);
    expect(isToolFailureLike({ isError: true })).toBe(true);
  });

  it("成功结果与空值不误判", () => {
    expect(isToolFailureLike({ success: true, url: "https://x" })).toBe(false);
    expect(isToolFailureLike({})).toBe(false);
    expect(isToolFailureLike(undefined)).toBe(false);
    expect(isToolFailureLike(null)).toBe(false);
    expect(isToolFailureLike("error string")).toBe(false);
    expect(isToolFailureLike(42)).toBe(false);
  });
});
