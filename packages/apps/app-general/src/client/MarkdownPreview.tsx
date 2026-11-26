"use client";

/**
 * Markdown 轻量排版预览（纯渲染，无状态）。
 * 覆盖标题/列表/代码块/段落的最小子集，供工作台文件预览使用。
 */
import React from "react";

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4 font-sans leading-relaxed text-sm">
      {content.split("\n\n").map((para, pIdx) => {
        if (para.startsWith("# ")) {
          return (
            <h1
              key={pIdx}
              className="text-xl font-bold border-b border-border pb-2 mt-4 text-foreground-strong"
            >
              {para.replace(/^#\s+/, "")}
            </h1>
          );
        }
        if (para.startsWith("## ")) {
          return (
            <h2
              key={pIdx}
              className="text-base font-bold border-b border-border/50 pb-1 mt-3 text-foreground-strong"
            >
              {para.replace(/^##\s+/, "")}
            </h2>
          );
        }
        if (para.startsWith("### ")) {
          return (
            <h3
              key={pIdx}
              className="text-sm font-semibold mt-2 text-foreground-strong"
            >
              {para.replace(/^###\s+/, "")}
            </h3>
          );
        }
        if (para.startsWith("- ") || para.startsWith("* ")) {
          return (
            <ul
              key={pIdx}
              className="list-disc list-inside space-y-1 text-foreground-subtle pl-2"
            >
              {para.split("\n").map((li, lIdx) => (
                <li key={lIdx}>{li.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        if (para.startsWith("```")) {
          const lines = para.split("\n");
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre
              key={pIdx}
              className="p-3 rounded-lg bg-surface-sunken border border-border font-mono text-xs overflow-x-auto"
            >
              <code>{code}</code>
            </pre>
          );
        }
        return (
          <p key={pIdx} className="text-foreground-subtle whitespace-pre-line">
            {para}
          </p>
        );
      })}
    </div>
  );
}
