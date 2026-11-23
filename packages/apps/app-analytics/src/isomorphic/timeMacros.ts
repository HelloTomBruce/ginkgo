/**
 * 时间宏变量引擎（纯 isomorphic，零外部依赖）。
 *
 * 解决外部 API（http-mcp / stdio-cli）与 SQL 在看板留存刷新时的「滚动时间窗口」问题：
 * 捕获时将固定日期识别/编码为宏（如 {{$today - 7d}} / {{$start_of_month}}），
 * 刷新重放时动态代入当下实际时刻（new Date()），实现无偏差的滚动周期取数。
 */

// 基础正则支持：
// 1. {{$now}} / {{$now - 7d}} / {{$now + 1h}}
// 2. {{$today}} / {{$today - 30d}} / {{$today - 1m}} / {{$today - 1y}}
// 3. {{$start_of_month}} / {{$start_of_week}} / {{$start_of_year}} / {{$start_of_day}}
// 4. {{$end_of_month}} / {{$end_of_week}} / {{$end_of_year}} / {{$end_of_day}}
// 5. {{$timestamp}} / {{$timestamp - 86400}}

const MACRO_PATTERN =
  /\{\{\s*\$(now|today|start_of_month|start_of_week|start_of_year|start_of_day|end_of_month|end_of_week|end_of_year|end_of_day|timestamp)(?:\s*([+-])\s*(\d+)\s*([smhdwMy])?)?\s*\}\}/g;

/** 日期格式化：YYYY-MM-DD */
export function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 时间加减计算 */
function addOffset(date: Date, sign: string, amount: number, unit?: string): Date {
  const mult = sign === "-" ? -1 : 1;
  const res = new Date(date.getTime());
  switch (unit) {
    case "s":
      res.setSeconds(res.getSeconds() + mult * amount);
      break;
    case "m":
      res.setMinutes(res.getMinutes() + mult * amount);
      break;
    case "h":
      res.setHours(res.getHours() + mult * amount);
      break;
    case "w":
      res.setDate(res.getDate() + mult * amount * 7);
      break;
    case "M":
      res.setMonth(res.getMonth() + mult * amount);
      break;
    case "y":
      res.setFullYear(res.getFullYear() + mult * amount);
      break;
    case "d":
    default:
      res.setDate(res.getDate() + mult * amount);
      break;
  }
  return res;
}

/** 计算周期边界 */
function getBoundaryDate(type: string, base: Date): Date {
  const d = new Date(base.getTime());
  if (type === "start_of_day") {
    d.setHours(0, 0, 0, 0);
  } else if (type === "end_of_day") {
    d.setHours(23, 59, 59, 999);
  } else if (type === "start_of_week") {
    // 依周一为一周起点
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
  } else if (type === "end_of_week") {
    const day = d.getDay();
    const diff = (day === 0 ? 0 : 7) - day;
    d.setDate(d.getDate() + diff);
    d.setHours(23, 59, 59, 999);
  } else if (type === "start_of_month") {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  } else if (type === "end_of_month") {
    d.setMonth(d.getMonth() + 1, 0);
    d.setHours(23, 59, 59, 999);
  } else if (type === "start_of_year") {
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
  } else if (type === "end_of_year") {
    d.setMonth(11, 31);
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

/**
 * 求解单个时间宏标记对应的字符串值。
 */
export function resolveSingleMacro(
  macroName: string,
  sign?: string,
  amountStr?: string,
  unit?: string,
  now: Date = new Date()
): string {
  const amount = amountStr ? parseInt(amountStr, 10) : 0;

  if (macroName === "timestamp") {
    let t = now.getTime();
    if (sign && amount > 0) {
      const mult = sign === "-" ? -1 : 1;
      const msUnit =
        unit === "s"
          ? 1000
          : unit === "m"
            ? 60 * 1000
            : unit === "h"
              ? 3600 * 1000
              : unit === "d"
                ? 86400 * 1000
                : 1000;
      t += mult * amount * msUnit;
    }
    return String(t);
  }

  let targetDate: Date;
  if (macroName.startsWith("start_of_") || macroName.startsWith("end_of_")) {
    targetDate = getBoundaryDate(macroName, now);
  } else {
    targetDate = new Date(now.getTime());
  }

  if (sign && amount > 0) {
    targetDate = addOffset(targetDate, sign, amount, unit);
  }

  if (macroName === "today" || macroName.startsWith("start_of_") || macroName.startsWith("end_of_")) {
    return formatDate(targetDate);
  }

  return targetDate.toISOString();
}

/**
 * 递归求解字符串、对象或数组中的时间宏。
 */
export function evaluateTimeMacros<T>(input: T, now: Date = new Date()): T {
  if (typeof input === "string") {
    // 若整个字符串仅为一个宏，且为 timestamp，原样返回字符串数字
    const evaluated = input.replace(
      MACRO_PATTERN,
      (_match, name, sign, amount, unit) => {
        return resolveSingleMacro(name, sign, amount, unit, now);
      }
    );
    return evaluated as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => evaluateTimeMacros(item, now)) as unknown as T;
  }

  if (input !== null && typeof input === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      res[k] = evaluateTimeMacros(v, now);
    }
    return res as unknown as T;
  }

  return input;
}

/** 识别常见 ISO / YYYY-MM-DD 日期格式 */
const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_FORMAT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?$/;

/** 判断字段名是否具备时间/日期语义 */
export function isTimeField(key?: string): boolean {
  if (!key) return true; // 未知上下文时保持宽松（如顶层标量）
  const lower = key.toLowerCase();
  return (
    lower.includes("time") ||
    lower.includes("date") ||
    lower.includes("created") ||
    lower.includes("updated") ||
    lower.includes("start") ||
    lower.includes("end") ||
    lower.includes("since") ||
    lower.includes("until") ||
    lower.includes("before") ||
    lower.includes("after") ||
    lower.includes("day") ||
    lower.includes("month") ||
    lower.includes("year")
  );
}

/**
 * 捕获期推测：将字面值相对日期识别为宏表达式。
 * 例如基准时间为 2026-11-11 时：
 * "2026-11-04" -> "{{$today - 7d}}"
 * "2026-11-01" -> "{{$start_of_month}}"
 */
export function inferTimeMacro(
  val: string,
  now: Date = new Date(),
  fieldName?: string
): string | null {
  // 若提供了明确字段名且非时间语义字段（如 title, name, description, id），不进行过度推测
  if (fieldName && !isTimeField(fieldName)) return null;

  const cleanVal = val.trim();
  const isDateOnly = DATE_FORMAT_RE.test(cleanVal);
  const isIso = ISO_FORMAT_RE.test(cleanVal);

  if (!isDateOnly && !isIso) return null;

  const targetTime = new Date(cleanVal).getTime();
  if (isNaN(targetTime)) return null;

  const todayStr = formatDate(now);
  if (isDateOnly) {
    if (cleanVal === todayStr) return "{{$today}}";

    const startOfMonth = formatDate(getBoundaryDate("start_of_month", now));
    if (cleanVal === startOfMonth) return "{{$start_of_month}}";

    const startOfWeek = formatDate(getBoundaryDate("start_of_week", now));
    if (cleanVal === startOfWeek) return "{{$start_of_week}}";

    const startOfYear = formatDate(getBoundaryDate("start_of_year", now));
    if (cleanVal === startOfYear) return "{{$start_of_year}}";

    // 计算天数差
    const nowDateOnly = new Date(todayStr).getTime();
    const targetDateOnly = new Date(cleanVal).getTime();
    const diffDays = Math.round((nowDateOnly - targetDateOnly) / (86400 * 1000));

    // 常用分析相对窗口：限制在 90 天内，避免将大半年前的历史固定事件篡改为滚动周期
    if (diffDays > 0 && diffDays <= 90) {
      if (diffDays % 7 === 0 && diffDays <= 28) {
        return `{{$today - ${diffDays / 7}w}}`;
      }
      return `{{$today - ${diffDays}d}}`;
    }
  }

  return null;
}

/**
 * 遍历入参对象，将能识别为相对时间的值转换为宏表达式。
 */
export function inferTimeMacrosInObject<T>(input: T, now: Date = new Date(), parentKey?: string): T {
  if (typeof input === "string") {
    const macro = inferTimeMacro(input, now, parentKey);
    return (macro ?? input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => inferTimeMacrosInObject(item, now, parentKey)) as unknown as T;
  }

  if (input !== null && typeof input === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      res[k] = inferTimeMacrosInObject(v, now, k);
    }
    return res as unknown as T;
  }

  return input;
}
