import { describe, it, expect } from "vitest";
import { extractOpenUI } from "./extractOpenUI";

describe("extractOpenUI", () => {
  it("提取 ```openui 围栏内容并从正文移除", () => {
    const raw = "分析如下：\n```openui\nroot = Root([])\n```\n以上。";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
    expect(textPart).toBe("分析如下：\n\n以上。");
    expect(textPart).not.toContain("root = Root");
  });

  it("```sql 围栏不进入渲染器，正文原样保留", () => {
    const raw = "查询语句：\n```sql\nSELECT * FROM t\n```";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("```json 围栏不进入渲染器", () => {
    const raw = "数据：\n```json\n{\"a\":1}\n```";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("未标注语言的裸围栏按 openui 兜底处理", () => {
    const raw = "```\nroot = Root([])\n```";
    const { openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
  });

  it("流式未闭合的 openui 围栏也能提取，并标识 isClosed=false", () => {
    const raw = "```openui\nroot = Root([car";
    const { openuiPart, isClosed } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([car");
    expect(isClosed).toBe(false);
  });

  it("已闭合的 openui 围栏标识 isClosed=true", () => {
    const raw = "```openui\nroot = Root([])\n```";
    const { openuiPart, isClosed } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
    expect(isClosed).toBe(true);
  });

  it("流式未闭合的裸围栏不进入渲染器，正文原样保留", () => {
    const raw = "配置说明：\n```\nkey: value\n更多分析文本...";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("无代码块时正文原样返回", () => {
    const raw = "纯文本回答，没有代码块。";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(textPart).toBe(raw);
    expect(openuiPart).toBe("");
  });

  it("sql 在前、openui 在后时：openui 进渲染器，sql 留在正文", () => {
    const raw = "```sql\nSELECT 1\n```\n看板：\n```openui\nroot = Root([])\n```";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
    expect(textPart).toContain("SELECT 1");
    expect(textPart).not.toContain("root = Root");
  });

  it("语言标签大小写不敏感（OpenUI/OPENUI）", () => {
    const { openuiPart } = extractOpenUI("```OpenUI\nroot = Root([])\n```");
    expect(openuiPart).toBe("root = Root([])");
  });

  it("多个 ```openui 围栏时：提取最后一个作为看板，正文剥离所有 openui 围栏", () => {
    const raw = "初稿：\n```openui\nroot = Root([card1])\n```\n说明文本...\n终版：\n```openui\nroot = Root([card2])\n```\n交付完成。";
    const { textPart, openuiPart, isClosed } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([card2])");
    expect(isClosed).toBe(true);
    expect(textPart).toContain("初稿：");
    expect(textPart).toContain("说明文本...");
    expect(textPart).toContain("终版：");
    expect(textPart).toContain("交付完成。");
    expect(textPart).not.toContain("root = Root([card1])");
    expect(textPart).not.toContain("root = Root([card2])");
    expect(textPart).not.toContain("```openui");
  });

  it("空输入安全返回", () => {
    expect(extractOpenUI("")).toEqual({ textPart: "", openuiPart: "" });
  });
});
