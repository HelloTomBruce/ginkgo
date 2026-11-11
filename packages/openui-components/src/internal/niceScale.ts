/**
 * 双 Y 轴刻度对齐算法（Nice Scales）
 * 为多轴复合图表生成等分、对齐且易于心算的刻度网格。
 */

export interface NiceScaleResult {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * 选取最贴近的友好步长 (1, 2, 2.5, 5, 10) * 10^n
 */
export function getNiceStep(range: number, targetSegments = 5): number {
  if (range <= 0) return 1;
  const rawStep = range / targetSegments;
  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / Math.pow(10, exponent);

  let niceFraction = 1;
  if (fraction <= 1.2) {
    niceFraction = 1;
  } else if (fraction <= 2.2) {
    niceFraction = 2;
  } else if (fraction <= 3.5) {
    niceFraction = 2.5;
  } else if (fraction <= 7.5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  const step = niceFraction * Math.pow(10, exponent);
  // 处理浮点精度问题（如 0.1 + 0.2）
  return parseFloat(step.toPrecision(12));
}

/**
 * 为单一范围生成指定段数的 Nice Scale
 */
export function calculateNiceScale(
  rawMin: number,
  rawMax: number,
  segments = 5
): NiceScaleResult {
  if (rawMin === rawMax) {
    const base = rawMin === 0 ? 0 : rawMin > 0 ? 0 : rawMin * 1.2;
    const top = rawMin === 0 ? segments : rawMin > 0 ? rawMin * 1.2 : 0;
    const step = getNiceStep(top - base, segments);
    const ticks: number[] = [];
    for (let i = 0; i <= segments; i++) {
      ticks.push(parseFloat((base + i * step).toPrecision(12)));
    }
    return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
  }

  // 若下限非负，基线归 0
  const min = rawMin >= 0 ? 0 : rawMin;
  const max = rawMax <= 0 ? 0 : rawMax;
  const range = max - min;
  const step = getNiceStep(range, segments);

  const niceMin = Math.floor(min / step) * step;
  const niceMax = niceMin + step * segments >= max
    ? niceMin + step * segments
    : Math.ceil(max / step) * step;

  // 重新计算实际段数对应的 step
  const actualSegments = Math.max(1, Math.round((niceMax - niceMin) / step));
  const ticks: number[] = [];
  for (let i = 0; i <= actualSegments; i++) {
    ticks.push(parseFloat((niceMin + i * step).toPrecision(12)));
  }

  return {
    min: ticks[0],
    max: ticks[ticks.length - 1],
    ticks,
  };
}

/**
 * 双轴刻度归一与等分对齐算法：
 * 保证左右两轴 ticks 数组的长度完全一致，使得横向网格线 100% 对齐。
 */
export function calculateDualNiceScales(
  leftValues: number[],
  rightValues: number[],
  targetSegments = 5
): {
  left: NiceScaleResult;
  right: NiceScaleResult | null;
} {
  const getMinMax = (vals: number[]) => {
    const valid = vals.filter((v) => typeof v === "number" && !isNaN(v));
    if (valid.length === 0) return { min: 0, max: 10 };
    let min = Math.min(...valid);
    let max = Math.max(...valid);
    if (min === max) {
      if (max === 0) max = 10;
      else if (max > 0) min = 0;
      else max = 0;
    }
    return { min, max };
  };

  const leftBounds = getMinMax(leftValues);
  const leftScale = calculateNiceScale(leftBounds.min, leftBounds.max, targetSegments);

  if (rightValues.length === 0) {
    return { left: leftScale, right: null };
  }

  const rightBounds = getMinMax(rightValues);
  // 对齐段数：必须与 leftScale.ticks.length - 1 保持一致
  const alignedSegments = Math.max(1, leftScale.ticks.length - 1);
  const rightScale = calculateNiceScale(rightBounds.min, rightBounds.max, alignedSegments);

  // 若由于浮点/舍入导致段数不一致，以段数多的为准再平衡一次
  if (rightScale.ticks.length !== leftScale.ticks.length) {
    const maxSegments = Math.max(leftScale.ticks.length - 1, rightScale.ticks.length - 1);
    const finalLeft = calculateNiceScale(leftBounds.min, leftBounds.max, maxSegments);
    const finalRight = calculateNiceScale(rightBounds.min, rightBounds.max, maxSegments);
    return { left: finalLeft, right: finalRight };
  }

  return { left: leftScale, right: rightScale };
}
