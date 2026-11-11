"use client";

import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { toast } from "@/lib/toast";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/** 代码块组件（含语言标签与一键复制代码按钮） */
function CodeBlock({
  language,
  value,
}: {
  language?: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast("代码已复制到剪贴板", "success");
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <div className="my-2.5 rounded-xl border border-border bg-surface-sunken overflow-hidden text-xs font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised/50 border-b border-border-subtle text-foreground-faint text-[11px] select-none">
        <span className="font-semibold uppercase tracking-wider">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-foreground-subtle hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
          aria-label="复制代码"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-success-fg" />
              <span className="text-[10px] text-success-fg font-sans font-medium">
                已复制
              </span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="text-[10px] font-sans">复制</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto leading-relaxed">
        <pre className="m-0 whitespace-pre font-mono text-[12px] text-foreground">
          <code>{value}</code>
        </pre>
      </div>
    </div>
  );
}

/**
 * 消息富文本 Markdown 渲染器：
 * - 支持 GitHub Flavored Markdown (GFM)：表格、任务列表、删除线、自动链接
 * - 纯语义颜色 Token，完美适应明暗主题与打印模式
 * - 代码块支持语言标识与复制
 */
export const MarkdownContent = React.memo(function MarkdownContent({
  content,
  className = "",
}: MarkdownContentProps) {
  return (
    <div className={`markdown-body text-sm leading-relaxed break-words space-y-2 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 标题渲染
          h1: ({ children }) => (
            <h1 className="text-base font-bold my-2 text-foreground-strong">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold my-2 text-foreground-strong">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold my-1.5 text-foreground-strong">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-medium my-1 text-foreground-strong">
              {children}
            </h4>
          ),

          // 段落
          p: ({ children }) => (
            <p className="my-1.5 leading-relaxed text-foreground">
              {children}
            </p>
          ),

          // 强调 / 加粗
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground-strong">
              {children}
            </strong>
          ),

          // 列表
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 my-1.5 text-foreground pl-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 my-1.5 text-foreground pl-1">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">
              {children}
            </li>
          ),

          // 引用块
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-info-border pl-3 my-2 text-foreground-subtle italic bg-info-soft/10 py-1 rounded-r-md">
              {children}
            </blockquote>
          ),

          // 分隔线
          hr: () => <hr className="border-border-subtle my-3" />,

          // 避免 pre > div 非法嵌套，由 CodeBlock 自身接管容器
          pre: ({ children }) => <>{children}</>,

          // 链接
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-info-fg hover:underline underline-offset-2 transition-colors cursor-pointer"
            >
              {children}
            </a>
          ),

          // 表格
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-raised border-b border-border text-foreground-strong font-medium">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border-subtle">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-muted/30 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-foreground-strong whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-foreground">
              {children}
            </td>
          ),

          // 代码与代码块
          code: ({ className: codeClassName, children, ...props }) => {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const codeString = String(children).replace(/\n$/, "");

            // 多行代码块或带有语言声明的代码块
            if (match || codeString.includes("\n")) {
              return (
                <CodeBlock
                  language={match?.[1]}
                  value={codeString}
                />
              );
            }

            // 行内代码
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-surface-sunken border border-border-subtle font-mono text-[12px] text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
