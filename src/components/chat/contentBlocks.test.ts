import { describe, it, expect } from "vitest";
import {
  dedupeContentBlocks,
  type ContentBlock,
  type TextBlock,
} from "./contentBlocks";

function textBlock(id: string, textPart: string, openuiPart = ""): TextBlock {
  return { type: "text", id, textPart, openuiPart, isLast: false };
}

describe("dedupeContentBlocks 消息内冗余去重", () => {
  it("多个看板块时仅保留最后一个 openuiPart", () => {
    const blocks: ContentBlock[] = [
      textBlock("t1", "初稿说明", "root = Root([card1])"),
      { type: "tools", id: "tool1", tools: [] },
      textBlock("t2", "终稿说明", "root = Root([card2])"),
    ];
    const result = dedupeContentBlocks(blocks);
    const texts = result.filter((b): b is TextBlock => b.type === "text");
    expect(texts[0].openuiPart).toBe("");
    expect(texts[1].openuiPart).toBe("root = Root([card2])");
  });

  it("相邻长文复读同一大标题时截断较早者，保留其标题前的前置文本", () => {
    const long1 = `数据全部就绪。\n\n# 经营复盘报告\n\n${"正文".repeat(200)}`;
    const long2 = `# 经营复盘报告\n\n${"正文".repeat(200)}\n交付闭环 ✅`;
    const blocks: ContentBlock[] = [textBlock("t1", long1), textBlock("t2", long2)];
    const result = dedupeContentBlocks(blocks);
    const texts = result.filter((b): b is TextBlock => b.type === "text");
    expect(texts[0].textPart).toBe("数据全部就绪。");
    expect(texts[1].textPart).toBe(long2);
  });

  it("较早者全文即从重复标题开始时，置空整个 textPart", () => {
    const long1 = `# 经营复盘报告\n\n${"正文".repeat(200)}`;
    const long2 = `# 经营复盘报告\n\n${"正文".repeat(200)}\n交付闭环`;
    const result = dedupeContentBlocks([textBlock("t1", long1), textBlock("t2", long2)]);
    expect((result[0] as TextBlock).textPart).toBe("");
  });

  it("标题不同或短文本不去重", () => {
    const a = textBlock("t1", "# 报告A\n" + "内容".repeat(200));
    const b = textBlock("t2", "# 报告B\n" + "内容".repeat(200));
    const result = dedupeContentBlocks([a, b]);
    expect((result[0] as TextBlock).textPart).toContain("报告A");

    const short1 = textBlock("t1", "# 同标题\n短");
    const short2 = textBlock("t2", "# 同标题\n短");
    const result2 = dedupeContentBlocks([short1, short2]);
    expect((result2[0] as TextBlock).textPart).toContain("同标题");
  });

  it("单看板单文本不做任何改动", () => {
    const blocks: ContentBlock[] = [
      textBlock("t1", "分析报告", "root = Root([])"),
    ];
    const result = dedupeContentBlocks(blocks);
    expect((result[0] as TextBlock).openuiPart).toBe("root = Root([])");
    expect((result[0] as TextBlock).textPart).toBe("分析报告");
  });
});
