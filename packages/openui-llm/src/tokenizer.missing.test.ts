/**
 * WS-12 未安装回退用例（与 tokenizer.test.ts 隔离：vi.mock 按文件生效）。
 * js-tiktoken 导入失败时 createTiktokenEstimator 返回 undefined 并只 warn 一次。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("js-tiktoken", () => {
  throw new Error("ERR_MODULE_NOT_FOUND: js-tiktoken not installed");
});

describe("js-tiktoken 未安装回退", () => {
  it("createTiktokenEstimator 返回 undefined 且只 warn 一次", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createTiktokenEstimator } = await import("./tokenizer");
    const first = await createTiktokenEstimator("cl100k_base");
    const second = await createTiktokenEstimator("o200k_base");
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    const warns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("[tokenizer]")
    );
    expect(warns).toHaveLength(1);
    warnSpy.mockRestore();
  });
});
