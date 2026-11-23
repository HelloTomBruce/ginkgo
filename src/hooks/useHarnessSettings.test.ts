import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useHarnessSettings,
  DEFAULT_HARNESS_SETTINGS,
} from "./useHarnessSettings";

describe("useHarnessSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("默认加载出厂默认配置", () => {
    const { result } = renderHook(() => useHarnessSettings());
    expect(result.current.settings.engine.timeoutSeconds).toBe(30);
    expect(result.current.settings.engine.maxRetries).toBe(3);
    expect(result.current.settings.governance.dailyBudgetUsd).toBe(50.0);
    expect(result.current.settings.mcpRuntime.defaultTimeoutSeconds).toBe(30);
  });

  it("更新 engine 参数并同步持久化到 localStorage", () => {
    const { result } = renderHook(() => useHarnessSettings());

    act(() => {
      result.current.updateEngine({
        timeoutSeconds: 60,
        maxRetries: 5,
        autoHealing: false,
      });
    });

    expect(result.current.settings.engine.timeoutSeconds).toBe(60);
    expect(result.current.settings.engine.maxRetries).toBe(5);
    expect(result.current.settings.engine.autoHealing).toBe(false);

    const saved = JSON.parse(localStorage.getItem("ginkgo_harness_config") || "{}");
    expect(saved.engine.timeoutSeconds).toBe(60);
  });

  it("更新 governance 参数并持久化", () => {
    const { result } = renderHook(() => useHarnessSettings());

    act(() => {
      result.current.updateGovernance({
        dailyBudgetUsd: 100,
        telemetryEnabled: true,
        telemetrySampleRate: 50,
      });
    });

    expect(result.current.settings.governance.dailyBudgetUsd).toBe(100);
    expect(result.current.settings.governance.telemetryEnabled).toBe(true);
    expect(result.current.settings.governance.telemetrySampleRate).toBe(50);
  });

  it("支持重置为默认基线", () => {
    const { result } = renderHook(() => useHarnessSettings());

    act(() => {
      result.current.updateEngine({ timeoutSeconds: 99 });
    });
    expect(result.current.settings.engine.timeoutSeconds).toBe(99);

    act(() => {
      result.current.resetToDefaults();
    });

    expect(result.current.settings.engine.timeoutSeconds).toBe(
      DEFAULT_HARNESS_SETTINGS.engine.timeoutSeconds
    );
    expect(localStorage.getItem("ginkgo_harness_config")).toBeNull();
  });

  it("支持配置导出与导入 JSON", () => {
    const { result } = renderHook(() => useHarnessSettings());

    act(() => {
      result.current.updateEngine({ timeoutSeconds: 45 });
    });

    const exported = result.current.exportConfigJson();
    expect(exported).toContain('"timeoutSeconds": 45');

    // 尝试导入修改后的 json
    const modified = JSON.stringify({
      engine: { timeoutSeconds: 120 },
    });

    act(() => {
      const res = result.current.importConfigJson(modified);
      expect(res.success).toBe(true);
    });

    expect(result.current.settings.engine.timeoutSeconds).toBe(120);

    // 非法 json
    act(() => {
      const res = result.current.importConfigJson("invalid json {{{");
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });
});
