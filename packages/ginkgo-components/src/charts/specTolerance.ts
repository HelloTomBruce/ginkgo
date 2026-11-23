/**
 * specTolerance —— ChartSpec 与 JSON 解析的容错增强层：
 * 1. tryRepairTruncatedJson: 应对大模型流式生成时偶发的中断、截断、未闭合 JSON。
 * 2. normalizeLooseSpec: 宽松归一化 LLM 常见的微小格式瑕疵（别名 chartType、字符串数组形式的 dims/meas、缺失的 agg 等）。
 */

const CHART_TYPE_ALIASES: Record<string, string> = {
  column: "bar",
  barchart: "bar",
  bar_chart: "bar",
  stackedbar: "stacked-bar",
  stacked_bar: "stacked-bar",
  linechart: "line",
  line_chart: "line",
  areachart: "area",
  area_chart: "area",
  piechart: "pie",
  pie_chart: "pie",
  donutchart: "donut",
  donut_chart: "donut",
  scatterchart: "scatter",
  scatter_chart: "scatter",
  heatmapchart: "heatmap",
  heatmap_chart: "heatmap",
};

/**
 * 尝试修复被截断的 JSON 字符串（例如 Token 上限或连接中途中断产生的未闭合 JSON）
 */
export function tryRepairTruncatedJson(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }

  // 1. 若本身已经是合法 JSON，直接返回
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // 需尝试修复
  }

  // 2. 遍历跟踪状态：未闭合引号、转义字符、括号栈
  const stack: string[] = [];
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" || char === "]") {
        if (stack.length > 0) {
          const top = stack[stack.length - 1];
          if ((char === "}" && top === "{") || (char === "]" && top === "[")) {
            stack.pop();
          }
        }
      }
    }
  }

  let candidate = trimmed;
  // 若截断在未闭合的字符串中，闭合字符串
  if (inString) {
    candidate += '"';
  }

  // 检查尾部是否残留在 `:` 或 `,`，例如 `{"key":` 或 `{"a": 1,`
  // 这种情况下移除未完成的 key 或尾部逗号
  candidate = candidate.replace(/,\s*$/, "");
  candidate = candidate.replace(/:\s*$/, ': null');

  // 补全所有未闭合的括号
  const closing: string[] = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    closing.push(stack[i] === "{" ? "}" : "]");
  }
  const repaired = candidate + closing.join("");

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // 若直接补括号仍有语法残缺（例如 `{"a": 1, "bad_key` 补成 `{"a": 1, "bad_key"}` 但缺值），
    // 尝试把最后一个逗号及其后面未成型的键值段剪切掉
    const lastCommaIdx = candidate.lastIndexOf(",");
    if (lastCommaIdx > 0) {
      const cutCandidate = candidate.slice(0, lastCommaIdx);
      // 重新计算未闭合栈
      const subStack: string[] = [];
      let subInStr = false;
      let subEsc = false;
      for (let i = 0; i < cutCandidate.length; i++) {
        const c = cutCandidate[i];
        if (subInStr) {
          if (subEsc) subEsc = false;
          else if (c === "\\") subEsc = true;
          else if (c === '"') subInStr = false;
        } else {
          if (c === '"') subInStr = true;
          else if (c === "{" || c === "[") subStack.push(c);
          else if (c === "}" || c === "]") {
            if (subStack.length > 0) {
              const top = subStack[subStack.length - 1];
              if ((c === "}" && top === "{") || (c === "]" && top === "[")) subStack.pop();
            }
          }
        }
      }
      const subClosing = subStack.reverse().map((ch) => (ch === "{" ? "}" : "]")).join("");
      const secondAttempt = cutCandidate + subClosing;
      try {
        JSON.parse(secondAttempt);
        return secondAttempt;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 宽松归一化 LLM 生成的 Spec 原始对象
 */
export function normalizeLooseSpec(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...raw };

  // 1. chartType 别名规范化
  if (typeof result.chartType === "string") {
    const lower = result.chartType.trim().toLowerCase();
    result.chartType = CHART_TYPE_ALIASES[lower] ?? lower;
  }

  // 2. dims 宽松归一化：支持 ["col1", "col2"] 形式
  if (Array.isArray(result.dims)) {
    result.dims = result.dims
      .map((item) => {
        if (typeof item === "string") {
          return { field: item };
        }
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          const field = typeof rec.field === "string" ? rec.field : typeof rec.name === "string" ? rec.name : undefined;
          if (field) {
            return { ...rec, field };
          }
        }
        return item;
      })
      .filter(Boolean);
  }

  // 3. meas 宽松归一化：支持 ["m1", "m2"] 或缺少 agg 的情况（缺省赋予 "sum"）
  if (Array.isArray(result.meas)) {
    result.meas = result.meas
      .map((item) => {
        if (typeof item === "string") {
          return { field: item, agg: "sum" };
        }
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          const field = typeof rec.field === "string" ? rec.field : typeof rec.name === "string" ? rec.name : undefined;
          if (field) {
            const agg = typeof rec.agg === "string" ? rec.agg.toLowerCase() : "sum";
            return { ...rec, field, agg };
          }
        }
        return item;
      })
      .filter(Boolean);
  }

  // 4. 数据字段别名兼容：rows / dataset -> data
  if (!result.data && Array.isArray(result.rows)) {
    result.data = result.rows;
  } else if (!result.data && Array.isArray(result.dataset)) {
    result.data = result.dataset;
  }

  return result;
}
