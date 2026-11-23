import { describe, it, expect } from "vitest";
import {
  getNiceStep,
  calculateNiceScale,
  calculateDualNiceScales,
} from "./niceScale";

describe("niceScale 双 Y 轴刻度对齐算法", () => {
  it("getNiceStep: 计算贴近人眼习惯的步长 (1, 2, 2.5, 5, 10)", () => {
    expect(getNiceStep(100, 5)).toBe(20);
    expect(getNiceStep(50, 5)).toBe(10);
    expect(getNiceStep(12, 5)).toBe(2.5);
    expect(getNiceStep(0.8, 4)).toBe(0.2);
  });

  it("calculateNiceScale: 单轴刻度生成单调递增并覆盖数据区间", () => {
    const scale = calculateNiceScale(0, 87, 5);
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(87);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < scale.ticks.length; i++) {
      expect(scale.ticks[i]).toBeGreaterThan(scale.ticks[i - 1]);
    }
  });

  it("calculateDualNiceScales: 左右两轴的 ticks 长度绝对一致以实现网格完美对齐", () => {
    const leftValues = [120, 450, 890, 1200];
    const rightValues = [0.05, 0.12, 0.28, 0.35];

    const { left, right } = calculateDualNiceScales(leftValues, rightValues, 5);

    expect(right).not.toBeNull();
    expect(left.ticks.length).toBe(right!.ticks.length);
    expect(left.min).toBeLessThanOrEqual(120);
    expect(left.max).toBeGreaterThanOrEqual(1200);
    expect(right!.min).toBeLessThanOrEqual(0.05);
    expect(right!.max).toBeGreaterThanOrEqual(0.35);
  });

  it("当无右轴数据时，right 返回 null，left 正常计算", () => {
    const leftValues = [10, 20, 30];
    const { left, right } = calculateDualNiceScales(leftValues, []);
    expect(right).toBeNull();
    expect(left.ticks.length).toBeGreaterThan(0);
  });

  it("当数据全为 0 或空时，具有合理兜底", () => {
    const { left, right } = calculateDualNiceScales([0, 0], [0]);
    expect(left.ticks.length).toBeGreaterThan(0);
    expect(right?.ticks.length).toBe(left.ticks.length);
  });
});
