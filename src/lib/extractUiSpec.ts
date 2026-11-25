/**
 * 从模型输出中提取 UiSpec DSL 看板代码块。
 *
 * 契约规范：
 * 只有且仅有显式标记为 ```ginkgo 围栏的代码块才会进入 UiSpec 渲染器；
 * 所有其他代码块（未标注语言的裸围栏、```sql、```json、```bash、```diff 等）
 * 一律原汁原味保留在正文中按标准 Markdown 渲染，杜绝任何误吞正文或误当成看板。
 */

export interface ExtractedContent {
  /** 去除 ginkgo 代码块后的正文 */
  textPart: string;
  /** 提取出的 ginkgo DSL 源码（无则为空串） */
  uiSpecPart: string;
  /** 该 ginkgo 围栏是否已正常闭合（以 ``` 结束）；未闭合且非流式状态通常表示内容被 Token 长度截断 */
  isClosed?: boolean;
}

// 严格匹配显式标注的 ```ginkgo 围栏；末尾 (?:```|$) 兼容流式传输中尚未闭合的围栏。
const GINKGO_FENCE_RE = /```ginkgo[ \t]*\r?\n?([\s\S]*?)(?:```|$)/gi;

export function extractUiSpec(rawContent: string): ExtractedContent {
  if (!rawContent) return { textPart: rawContent ?? "", uiSpecPart: "" };

  const uiSpecMatches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  GINKGO_FENCE_RE.lastIndex = 0;

  while ((match = GINKGO_FENCE_RE.exec(rawContent)) !== null) {
    uiSpecMatches.push(match);
  }

  // 无 ```ginkgo 围栏：正文原样返回，uiSpecPart 为空
  if (uiSpecMatches.length === 0) {
    return { textPart: rawContent, uiSpecPart: "", isClosed: true };
  }

  // 存在显式 ```ginkgo 围栏：提取最后一个（最新/最终交付版本），并从正文中彻底剥离所有 ginkgo 围栏
  const targetMatch = uiSpecMatches[uiSpecMatches.length - 1];
  const isClosed = targetMatch[0].length >= 9 && targetMatch[0].endsWith("```");

  // 从后往前切除所有 ginkgo 围栏，避免索引漂移
  let cleanedText = rawContent;
  for (let i = uiSpecMatches.length - 1; i >= 0; i--) {
    const m = uiSpecMatches[i];
    cleanedText = cleanedText.slice(0, m.index) + cleanedText.slice(m.index + m[0].length);
  }

  return {
    textPart: cleanedText.trim(),
    uiSpecPart: targetMatch[1].trim(),
    isClosed,
  };
}
