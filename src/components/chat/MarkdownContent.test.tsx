import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MarkdownContent } from "./MarkdownContent";

afterEach(cleanup);

describe("MarkdownContent", () => {
  it("渲染加粗、标题、列表等标准 Markdown 结构", () => {
    const md = `
# 营收分析总结

根据近期数据，**核心指标**表现如下：
- 总销售额增长 25%
- 新客获取成本下降 10%
`;
    render(<MarkdownContent content={md} />);

    expect(screen.getByRole("heading", { level: 1, name: "营收分析总结" })).toBeInTheDocument();
    expect(screen.getByText("核心指标")).toHaveClass("font-semibold");
    expect(screen.getByText("总销售额增长 25%")).toBeInTheDocument();
  });

  it("支持 GFM 表格语法", () => {
    const md = `
| 渠道 | 获客数 | 转化率 |
| :--- | :--- | :--- |
| 自然搜索 | 1200 | 18% |
| 付费广告 | 800 | 12% |
`;
    render(<MarkdownContent content={md} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("自然搜索")).toBeInTheDocument();
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(screen.getByText("付费广告")).toBeInTheDocument();
  });

  it("支持代码块展示与复制代码", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const md = `
\`\`\`sql
SELECT channel, COUNT(*) as cnt FROM users GROUP BY channel;
\`\`\`
`;
    render(<MarkdownContent content={md} />);

    expect(screen.getByText(/sql/i)).toBeInTheDocument();
    expect(screen.getByText(/SELECT channel/)).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", { name: "复制代码" });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith("SELECT channel, COUNT(*) as cnt FROM users GROUP BY channel;");
  });

  it("支持行内代码与链接安全跳转", () => {
    const md = "请执行 `pnpm dev` 命令，参考 [文档](https://example.com/docs)";
    render(<MarkdownContent content={md} />);

    const inlineCode = screen.getByText("pnpm dev");
    expect(inlineCode.tagName.toLowerCase()).toBe("code");

    const link = screen.getByRole("link", { name: "文档" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("流式传输中支持 isStreaming 平滑渲染", () => {
    const { rerender } = render(<MarkdownContent content="初始文本" isStreaming={true} />);
    expect(screen.getByText("初始文本")).toBeInTheDocument();

    rerender(<MarkdownContent content="初始文本 增量内容" isStreaming={true} />);
    // 即使在流式中，组件也能稳定渲染且最终完成时直接呈现
    rerender(<MarkdownContent content="初始文本 增量内容 最终完成" isStreaming={false} />);
    expect(screen.getByText("初始文本 增量内容 最终完成")).toBeInTheDocument();
  });
});
