/**
 * 从模型输出中提取 UiSpec DSL 代码块。
 *
 * 只有 ```ginkgo 围栏或未标注语言的裸 ``` 围栏才会进入 UiSpec 渲染器；
 * ```sql / ```json 等其他语言围栏保留在正文中按纯文本/代码展示，
 * 避免被误吞进渲染器造成解析错误与正文缺失。
 */

export interface ExtractedContent {
  /** 去除 ginkgo 代码块后的正文 */
  textPart: string;
  /** 提取出的 ginkgo DSL 源码（无则为空串） */
  uiSpecPart: string;
  /** 该 ginkgo 围栏是否已正常闭合（以 ``` 结束）；未闭合且非流式状态通常表示内容被 Token 长度截断 */
  isClosed?: boolean;
}

// 带语言捕获的围栏匹配；末尾 (?:```|$) 兼容流式传输中尚未闭合的围栏。
// 扫描策略：第一个 ```ginkgo 围栏优先；否则回退到第一个未标注语言的裸围栏
// （模型忘记写语言标签时兜底）；```sql 等其他语言围栏一律留在正文。
const FENCE_RE = /```(\w*)[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;

export function extractUiSpec(rawContent: string): ExtractedContent {
  if (!rawContent) return { textPart: rawContent ?? "", uiSpecPart: "" };

  const uiSpecMatches: RegExpExecArray[] = [];
  let firstBare: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;

  while ((match = FENCE_RE.exec(rawContent)) !== null) {
    const lang = match[1].toLowerCase();
    const isClosed = match[0].length >= 6 && match[0].endsWith("```");

    if (lang === "ginkgo") {
      uiSpecMatches.push(match);
    } else if (lang === "" && isClosed && !firstBare) {
      // 仅在裸围栏已完整闭合时才允许兜底为 UiSpec，流式未闭合的裸围栏保留在正文
      firstBare = match;
    }
  }

  // 1. 存在显式 ```ginkgo 围栏：提取最后一个（最新/最终交付版本），并从正文中彻底剥离所有 ginkgo 围栏
  if (uiSpecMatches.length > 0) {
    const targetMatch = uiSpecMatches[uiSpecMatches.length - 1];
    const isClosed = targetMatch[0].length >= 6 && targetMatch[0].endsWith("```");

    // 从后往前切除所有 ginkgo 围栏，避免索引漂移
    let cleanedText = rawContent;
    for (let i = uiSpecMatches.length - 1; i >= 0; i--) {
      const m = uiSpecMatches[i];
      cleanedText = cleanedText.slice(0, m.index) + cleanedText.slice(m.index + m[0].length);
    }

    return {
      textPart: cleanedText.trim(),
      uiSpecPart: targetMatch[2].trim(),
      isClosed,
    };
  }

  // 2. 兜底回退：裸围栏
  if (firstBare) {
    return {
      textPart: (
        rawContent.slice(0, firstBare.index) +
        rawContent.slice(firstBare.index + firstBare[0].length)
      ).trim(),
      uiSpecPart: firstBare[2].trim(),
      isClosed: true,
    };
  }

  return { textPart: rawContent, uiSpecPart: "", isClosed: true };
}
