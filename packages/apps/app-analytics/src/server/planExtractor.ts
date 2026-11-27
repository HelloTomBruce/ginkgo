import { createParser } from "@openuidev/lang-core";
import { serverLibrary } from "@ginkgolab/components/server";

/** WS-4:plan 代码块解析器(模块级构造一次;解析 PlanReviewCard.methods 用) */
const planParser = createParser(serverLibrary.toJSONSchema(), "Root");

/** 在解析 AST 中泛型递归查找指定组件的 props(lang-core 元素以 typeName 标识组件名) */
export function findComponentProps(
  node: unknown,
  componentName: string
): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as Record<string, unknown>;
  if (
    (n.typeName === componentName || n.name === componentName) &&
    n.props &&
    typeof n.props === "object"
  ) {
    return n.props as Record<string, unknown>;
  }
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        const found = findComponentProps(v, componentName);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findComponentProps(value, componentName);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * WS-4:plan 阶段 onFinish 从最后一步文本提取结构化方法列表。
 * 用 serverLibrary 的 parser 正规解析 ```ginkgo 代码块,读取 PlanReviewCard.methods;
 * 任何失败(无代码块/解析错误/缺 methods)返回 [],由调用方决定降级路径。
 */
export function extractPlanMethods(finalText: string): string[] {
  if (!finalText || typeof finalText !== "string") return [];
  const blockRe = /```ginkgo\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(finalText)) !== null) {
    const code = match[1];
    if (!code.includes("PlanReviewCard")) continue;
    try {
      const result = planParser.parse(code);
      const props = findComponentProps(result.root, "PlanReviewCard");
      const raw = props?.methods;
      if (Array.isArray(raw)) {
        const ids = raw
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .slice(0, 4);
        if (ids.length > 0) return ids;
      }
    } catch {
      // 单块解析失败继续尝试下一块(模型可能输出 InsightBox 附属块)
    }
  }
  return [];
}
