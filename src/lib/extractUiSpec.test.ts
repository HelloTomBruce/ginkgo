import { describe, it, expect } from "vitest";
import { extractUiSpec } from "./extractUiSpec";

describe("extractUiSpec", () => {
  it("提取 ```ginkgo 围栏内容并从正文移除", () => {
    const raw = "分析如下：\n```ginkgo\nroot = Root([])\n```\n以上。";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("root = Root([])");
    expect(textPart).toBe("分析如下：\n\n以上。");
    expect(textPart).not.toContain("root = Root");
  });

  it("```sql 围栏不进入渲染器，正文原样保留", () => {
    const raw = "查询语句：\n```sql\nSELECT * FROM t\n```";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("```json 围栏不进入渲染器", () => {
    const raw = "数据：\n```json\n{\"a\":1}\n```";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("未标注语言的裸围栏不进入看板渲染器，正文原样保留", () => {
    const raw = "配置说明：\n```\nkey: value\nroot = Root([])\n```\n以上。";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("普通裸代码块（如 git status、shell 命令）100% 保留在正文，绝不提取为看板", () => {
    const raw = "工作区还有未提交改动：\n```\nM .env.production\nM package.json\n```\n请确认。";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("流式未闭合的 ginkgo 围栏也能提取，并标识 isClosed=false", () => {
    const raw = "```ginkgo\nroot = Root([car";
    const { uiSpecPart, isClosed } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("root = Root([car");
    expect(isClosed).toBe(false);
  });

  it("已闭合的 ginkgo 围栏标识 isClosed=true", () => {
    const raw = "```ginkgo\nroot = Root([])\n```";
    const { uiSpecPart, isClosed } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("root = Root([])");
    expect(isClosed).toBe(true);
  });

  it("流式未闭合的裸围栏不进入渲染器，正文原样保留", () => {
    const raw = "配置说明：\n```\nkey: value\n更多分析文本...";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("无代码块时正文原样返回", () => {
    const raw = "纯文本回答，没有代码块。";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(textPart).toBe(raw);
    expect(uiSpecPart).toBe("");
  });

  it("sql 在前、ginkgo 在后时：ginkgo 进渲染器，sql 留在正文", () => {
    const raw = "```sql\nSELECT 1\n```\n看板：\n```ginkgo\nroot = Root([])\n```";
    const { textPart, uiSpecPart } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("root = Root([])");
    expect(textPart).toContain("SELECT 1");
    expect(textPart).not.toContain("root = Root");
  });

  it("语言标签大小写不敏感（Ginkgo/ginkgo）", () => {
    const { uiSpecPart } = extractUiSpec("```Ginkgo\nroot = Root([])\n```");
    expect(uiSpecPart).toBe("root = Root([])");
  });

  it("多个 ```ginkgo 围栏时：提取最后一个作为看板，正文剥离所有 ginkgo 围栏", () => {
    const raw = "初稿：\n```ginkgo\nroot = Root([card1])\n```\n说明文本...\n终版：\n```ginkgo\nroot = Root([card2])\n```\n交付完成。";
    const { textPart, uiSpecPart, isClosed } = extractUiSpec(raw);
    expect(uiSpecPart).toBe("root = Root([card2])");
    expect(isClosed).toBe(true);
    expect(textPart).toContain("初稿：");
    expect(textPart).toContain("说明文本...");
    expect(textPart).toContain("终版：");
    expect(textPart).toContain("交付完成。");
    expect(textPart).not.toContain("root = Root([card1])");
    expect(textPart).not.toContain("root = Root([card2])");
    expect(textPart).not.toContain("```ginkgo");
  });

  it("空输入安全返回", () => {
    expect(extractUiSpec("")).toEqual({ textPart: "", uiSpecPart: "" });
  });
});
