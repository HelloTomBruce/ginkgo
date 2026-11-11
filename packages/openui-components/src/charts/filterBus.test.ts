import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  emitFilterChange,
  onFilterChange,
  resetFilterBus,
} from "./filterBus";

describe("filterBus 筛选事件总线", () => {
  beforeEach(() => {
    resetFilterBus();
  });

  it("全局广播可被未限定 scope 的监听者接收", () => {
    const cb = vi.fn();
    const off = onFilterChange(cb);

    emitFilterChange({ field: "channel", value: "google" });
    expect(cb).toHaveBeenCalledWith({ field: "channel", value: "google" });

    off();
    emitFilterChange({ field: "channel", value: "tiktok" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("同 scopeId 的事件仅被匹配的监听者接收，不同 scopeId 互相隔离", () => {
    const cbScopeA = vi.fn();
    const cbScopeB = vi.fn();

    onFilterChange(cbScopeA, "dashboard-A");
    onFilterChange(cbScopeB, "dashboard-B");

    // 触发 scope A
    emitFilterChange({ field: "region", value: "east", scopeId: "dashboard-A" });
    expect(cbScopeA).toHaveBeenCalledTimes(1);
    expect(cbScopeB).not.toHaveBeenCalled();

    // 触发 scope B
    emitFilterChange({ field: "region", value: "west", scopeId: "dashboard-B" });
    expect(cbScopeA).toHaveBeenCalledTimes(1);
    expect(cbScopeB).toHaveBeenCalledTimes(1);
  });

  it("未带 scopeId 的全局事件分发给所有指定了 scope 的监听者", () => {
    const cbScopeA = vi.fn();
    const cbScopeB = vi.fn();

    onFilterChange(cbScopeA, "dashboard-A");
    onFilterChange(cbScopeB, "dashboard-B");

    emitFilterChange({ field: "date", value: "2026-Q1" });
    expect(cbScopeA).toHaveBeenCalledTimes(1);
    expect(cbScopeB).toHaveBeenCalledTimes(1);
  });
});
