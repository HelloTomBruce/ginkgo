/**
 * Actionable Error 协议（Prompt Engineering：Guidance Error Self-Healing）。
 *
 * 为什么不直接回传裸 message：模型收到「SQL 执行失败: column "cac" does not exist」
 * 这类原始错误时，缺乏「下一步怎么做」的结构化指引，容易拿着相同形态的参数反复试错
 * （配合编排层死锁熔断形成防线的最后一道）。这里把已知的错误源模式翻译为
 * { errorCode, remediation } 结构化反馈——remediation 给出具体的替代工具与修正方向。
 *
 * 收口点：adapters/ai.ts 的 catch（所有数据源工具异常的最终接住点），
 * dbTools 双形态（MCP text → parseToolResult 抛出 → 此处接住）自动覆盖。
 */

export interface ActionableError {
  errorCode: string;
  remediation: string;
}

/** dbTools 各分支对原始错误附加的前缀（剥掉后再匹配，防前缀噪声干扰模式识别） */
const KNOWN_PREFIXES = ["SQL 执行失败: ", "目录查询失败: ", "读取目录失败: "];

function stripKnownPrefixes(message: string): string {
  let out = message;
  for (const prefix of KNOWN_PREFIXES) {
    if (out.startsWith(prefix)) out = out.slice(prefix.length);
  }
  return out;
}

/**
 * 把工具错误消息分类为结构化可行动反馈。模式表按「最具体优先」排序；
 * 未命中走兜底（通用修正指引）。大小写不敏感匹配，兼容各数据库方言的中英文报错。
 */
export function toActionableError(message: string): ActionableError {
  const msg = stripKnownPrefixes(message);
  const lower = msg.toLowerCase();

  // sqlGuard 的只读拦截（带「安全限制：」前缀，见 connectors/db/sqlGuard.ts）
  if (msg.includes("安全限制") || msg.includes("禁止")) {
    return {
      errorCode: "SQL_READONLY_VIOLATION",
      remediation:
        "本工具仅支持只读 SELECT/WITH 查询，DDL/DML 与多语句会被物理拦截。请把聚合、过滤全部放进单条 SELECT 内完成；确需写操作时向用户如实说明数据源为只读。",
    };
  }
  // 表不存在（describe_table 空列分支、各方言 no such table/does not exist）。
  // 注意：explainGuard 预检会把表不存在包在「执行计划预检失败」外壳里，
  // 因此表/列/语法的根因判定必须排在代价类（QUERY_TOO_EXPENSIVE）之前
  if (
    msg.includes("未找到数据表") ||
    /no such table/i.test(lower) ||
    (/relation\b.*does not exist/i.test(lower) && !/column\b/i.test(lower)) ||
    /table\b.*doesn't exist/i.test(lower) ||
    /unknown table/i.test(lower)
  ) {
    return {
      errorCode: "TABLE_NOT_FOUND",
      remediation:
        "引用的数据表不存在或名称有误。请先调用 list_tables 查看可用表名，再用 describe_table 确认表结构后修正 SQL 重试。",
    };
  }
  // 列不存在（各方言 unknown column / no such column / column does not exist / Binder Error）
  if (
    /unknown column/i.test(lower) ||
    /no such column/i.test(lower) ||
    /column\b.*does not exist/i.test(lower) ||
    /referenced column\b.*not found/i.test(lower) ||
    /column\b.*not found/i.test(lower) ||
    msg.includes("列名与类型不匹配")
  ) {
    return {
      errorCode: "COLUMN_NOT_FOUND",
      remediation:
        "引用的列不存在。请调用 describe_table 获取准确列名（注意大小写与含空格/标点列名需双引号包裹），修正后重试。",
    };
  }
  // 语法错误（syntax error at/near 等）
  if (/syntax error/i.test(lower) || msg.includes("语法")) {
    return {
      errorCode: "SQL_SYNTAX_ERROR",
      remediation:
        "SQL 语法不符合该数据源方言。请按该源 dbType 对应方言修正语法（注意函数名、引号风格与占位符形式）后重试。",
    };
  }
  // EXPLAIN 预检失败 / 扫描行数超预算（queryPipeline/explainGuard）——
  // 纯代价类（已排除上方表/列/语法根因）
  if (msg.includes("执行计划") || msg.includes("扫描数据行数") || msg.includes("预算")) {
    return {
      errorCode: "QUERY_TOO_EXPENSIVE",
      remediation:
        "查询代价超预算。请增加 WHERE 过滤、限制时间窗、先 LIMIT 小样本探查，并把聚合（GROUP BY/SUM/COUNT）下推到 SQL 内完成后再重试。",
    };
  }
  // 超时
  if (/timeout|timed out/i.test(lower) || msg.includes("超时")) {
    return {
      errorCode: "QUERY_TIMEOUT",
      remediation:
        "查询超时。请缩小查询范围（加 WHERE / LIMIT / 收窄时间窗）后重试，避免全表扫描。",
    };
  }
  // 连接类失败（源不可达）
  if (
    /econnrefused|econnreset|connection refused|connect etimedout|getaddrinfo/i.test(lower) ||
    msg.includes("不可达")
  ) {
    return {
      errorCode: "SOURCE_UNAVAILABLE",
      remediation:
        "数据源连接失败（服务未启动或地址不可达）。请勿反复重试同一调用，基于已有信息继续分析或向用户如实说明该源暂不可用。",
    };
  }
  // 兜底：无模式命中时的通用指引
  return {
    errorCode: "TOOL_EXECUTION_FAILED",
    remediation:
      "工具执行失败。请检查参数是否正确；或改用其他工具完成同一目标；仍失败则向用户如实反馈失败原因，不要编造结果。",
  };
}
