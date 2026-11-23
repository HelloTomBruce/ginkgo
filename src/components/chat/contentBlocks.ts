/**
 * 消息内容块模型与冗余去重（从 MessageList 抽出的纯逻辑，便于函数级测试）。
 *
 * 背景：模型在工具调用前后可能复读输出两份一模一样的报告与看板（尤其 finish_task
 * 终态确认后），渲染前需要做防御性去重，保证单条回复至多渲染一个看板。
 */

export interface ToolInvocationState {
  state: "call" | "result" | "partial-call";
  toolCallId: string;
  toolName: string;
  args?: { sql?: string; [key: string]: unknown };
  result?: unknown;
}

export type TextBlock = {
  type: "text";
  id: string;
  textPart: string;
  uiSpecPart: string;
  isClosed?: boolean;
  isLast: boolean;
};

export type ToolsBlock = {
  type: "tools";
  id: string;
  tools: ToolInvocationState[];
};

export type ReasoningBlock = {
  type: "reasoning";
  id: string;
  reasoning: string;
  isLast: boolean;
};

export type ContentBlock = TextBlock | ToolsBlock | ReasoningBlock;

/**
 * 消息内冗余去重与防御（原地修改，调用方持有新构建的 blocks 数组）：
 * 1. 看板去重：多个 TextBlock 含 uiSpecPart 时仅保留最后一个（最新最全版本）；
 * 2. 长文报告去重：相邻 TextBlock 复读同一大标题且均为长文时，截断较早者的重复段。
 */
export function dedupeContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  // 1. 看板去重
  const uiSpecIndices: number[] = [];
  blocks.forEach((b, i) => {
    if (b.type === "text" && b.uiSpecPart) uiSpecIndices.push(i);
  });
  if (uiSpecIndices.length > 1) {
    for (let k = 0; k < uiSpecIndices.length - 1; k++) {
      (blocks[uiSpecIndices[k]] as TextBlock).uiSpecPart = "";
    }
  }

  // 2. 长文报告去重
  const textBlocks = blocks.filter((b): b is TextBlock => b.type === "text");
  if (textBlocks.length > 1) {
    const headerRe = /^#+\s+(.+)$/m;
    for (let i = 0; i < textBlocks.length - 1; i++) {
      const curr = textBlocks[i];
      const next = textBlocks[i + 1];
      const currHeaderMatch = curr.textPart.match(headerRe);
      const nextHeaderMatch = next.textPart.match(headerRe);

      if (
        currHeaderMatch &&
        nextHeaderMatch &&
        currHeaderMatch[1].trim() === nextHeaderMatch[1].trim() &&
        curr.textPart.length > 300 &&
        next.textPart.length > 300
      ) {
        const headerIndex = curr.textPart.indexOf(currHeaderMatch[0]);
        curr.textPart =
          headerIndex > 0 ? curr.textPart.slice(0, headerIndex).trim() : "";
      }
    }
  }

  return blocks;
}
