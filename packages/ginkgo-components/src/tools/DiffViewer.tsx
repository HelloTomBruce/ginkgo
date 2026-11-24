"use client";

import React, { useState, useMemo } from "react";
import { Copy, Check, ChevronDown, ChevronRight, Split, AlignJustify } from "lucide-react";

export interface DiffLine {
  type: "add" | "delete" | "normal";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * 轻量且稳健的逐行 LCS Diff 算法
 */
export function computeLineDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.split(/\r?\n/);
  const modLines = modified.split(/\r?\n/);

  const n = origLines.length;
  const m = modLines.length;

  // 边界保护：若文本过长（如超过 3000 行），降级为简化追加/替换以防矩阵溢出
  if (n * m > 2_000_000) {
    const diff: DiffLine[] = [];
    origLines.forEach((text, i) => diff.push({ type: "delete", text, oldLineNumber: i + 1 }));
    modLines.forEach((text, i) => diff.push({ type: "add", text, newLineNumber: i + 1 }));
    return diff;
  }

  // 构建 LCS 动态规划表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯产出差异序列
  const result: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      result.push({
        type: "normal",
        text: origLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({
        type: "add",
        text: modLines[j - 1],
        newLineNumber: j,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      result.push({
        type: "delete",
        text: origLines[i - 1],
        oldLineNumber: i,
      });
      i--;
    }
  }

  return result.reverse();
}

/**
 * 解析 Git 格式 diff 字符串（如果输入是 diff --git / unified patch 文本）
 */
export function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines = diffText.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oldNum = 1;
  let newNum = 1;

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ")) {
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[2], 10);
      }
      continue;
    }
    if (line.startsWith("+")) {
      result.push({
        type: "add",
        text: line.slice(1),
        newLineNumber: newNum++,
      });
    } else if (line.startsWith("-")) {
      result.push({
        type: "delete",
        text: line.slice(1),
        oldLineNumber: oldNum++,
      });
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      result.push({
        type: "normal",
        text,
        oldLineNumber: oldNum++,
        newLineNumber: newNum++,
      });
    }
  }

  return result;
}

export interface DiffViewerProps {
  /** 原始文本（与 modified 配套） */
  original?: string;
  /** 修改后文本 */
  modified?: string;
  /** 或者直接传入 Unified Diff 文本 */
  diffText?: string;
  /** 文件路径或标题展示 */
  title?: string;
  /** 默认单栏 (unified) 或双栏 (split) */
  defaultMode?: "unified" | "split";
  /** 是否默认折叠过长的未变更行 */
  foldUnchanged?: boolean;
  /** 初始是否展开卡片内容 */
  defaultOpen?: boolean;
  className?: string;
}

export function DiffViewer({
  original,
  modified,
  diffText,
  title,
  defaultMode = "unified",
  foldUnchanged = true,
  defaultOpen = true,
  className = "",
}: DiffViewerProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [viewMode, setViewMode] = useState<"unified" | "split">(defaultMode);
  const [copied, setCopied] = useState(false);
  const [expandedFolds, setExpandedFolds] = useState<Record<number, boolean>>({});

  const diffLines = useMemo(() => {
    if (typeof diffText === "string" && diffText.trim().length > 0) {
      return parseUnifiedDiff(diffText);
    }
    return computeLineDiff(original ?? "", modified ?? "");
  }, [original, modified, diffText]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const l of diffLines) {
      if (l.type === "add") additions++;
      if (l.type === "delete") deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetText = modified !== undefined ? modified : diffLines.map((l) => l.text).join("\n");
    void navigator.clipboard.writeText(targetText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 分块：计算长正常行的折叠区间（如连续 > 5 行正常代码）
  const renderBlocks = useMemo(() => {
    if (!foldUnchanged) {
      return [{ type: "lines" as const, lines: diffLines }];
    }

    const blocks: Array<
      | { type: "lines"; lines: DiffLine[] }
      | { type: "fold"; id: number; lines: DiffLine[]; count: number }
    > = [];

    let currentNormal: DiffLine[] = [];
    let foldId = 0;

    const flushNormal = () => {
      if (currentNormal.length > 6) {
        // 保留首尾各 2 行，中间折叠
        const head = currentNormal.slice(0, 2);
        const middle = currentNormal.slice(2, -2);
        const tail = currentNormal.slice(-2);
        if (head.length > 0) blocks.push({ type: "lines", lines: head });
        blocks.push({ type: "fold", id: foldId++, lines: middle, count: middle.length });
        if (tail.length > 0) blocks.push({ type: "lines", lines: tail });
      } else if (currentNormal.length > 0) {
        blocks.push({ type: "lines", lines: currentNormal });
      }
      currentNormal = [];
    };

    for (const line of diffLines) {
      if (line.type === "normal") {
        currentNormal.push(line);
      } else {
        flushNormal();
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === "lines") {
          lastBlock.lines.push(line);
        } else {
          blocks.push({ type: "lines", lines: [line] });
        }
      }
    }
    flushNormal();

    return blocks;
  }, [diffLines, foldUnchanged]);

  return (
    <div
      className={`rounded-xl border border-border bg-surface-sunken overflow-hidden text-xs font-mono shadow-xs transition-all ${className}`}
    >
      {/* 头部工具栏 */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-3.5 py-2.5 bg-card/60 border-b border-border cursor-pointer select-none hover:bg-card transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            className="p-0.5 text-foreground-subtle hover:text-foreground transition-colors"
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <span className="font-semibold text-foreground-strong truncate">
            {title || "代码变更比对 (Diff)"}
          </span>
          <div className="flex items-center gap-1.5 text-[11px] font-sans font-medium shrink-0">
            {stats.additions > 0 && (
              <span className="text-success-fg bg-success-soft px-1.5 py-0.5 rounded">
                +{stats.additions}
              </span>
            )}
            {stats.deletions > 0 && (
              <span className="text-danger-fg bg-danger-soft px-1.5 py-0.5 rounded">
                -{stats.deletions}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 单栏 / 双栏切换 */}
          <div
            className="flex items-center rounded-md border border-border bg-surface-sunken p-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setViewMode("unified")}
              title="单栏内联模式"
              className={`p-1 rounded transition-colors ${
                viewMode === "unified"
                  ? "bg-card text-foreground font-medium shadow-xs"
                  : "text-foreground-subtle hover:text-foreground"
              }`}
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              title="双栏对比模式"
              className={`p-1 rounded transition-colors ${
                viewMode === "split"
                  ? "bg-card text-foreground font-medium shadow-xs"
                  : "text-foreground-subtle hover:text-foreground"
              }`}
            >
              <Split className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            title="复制完整内容"
            className="p-1 rounded-md text-foreground-subtle hover:text-foreground hover:bg-card border border-transparent hover:border-border transition-colors flex items-center gap-1"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success-fg" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* 主体 Diff 内容 */}
      {isOpen && (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          {viewMode === "unified" ? (
            <table className="w-full border-collapse">
              <tbody>
                {renderBlocks.map((block, bIdx) => {
                  if (block.type === "fold") {
                    const isExpanded = expandedFolds[block.id];
                    if (isExpanded) {
                      return block.lines.map((line, lIdx) => (
                        <tr key={`f-${block.id}-${lIdx}`} className="leading-5 hover:bg-card/40">
                          <td className="w-10 px-2 py-0.5 text-right text-foreground-subtle/50 select-none border-r border-border/40">
                            {line.oldLineNumber}
                          </td>
                          <td className="w-10 px-2 py-0.5 text-right text-foreground-subtle/50 select-none border-r border-border/40">
                            {line.newLineNumber}
                          </td>
                          <td className="w-4 px-1 text-center select-none text-foreground-subtle/40">
                            {" "}
                          </td>
                          <td className="px-2 py-0.5 whitespace-pre font-mono text-foreground-subtle">
                            {line.text}
                          </td>
                        </tr>
                      ));
                    }
                    return (
                      <tr
                        key={`fold-${block.id}`}
                        onClick={() =>
                          setExpandedFolds((prev) => ({ ...prev, [block.id]: true }))
                        }
                        className="bg-card/30 hover:bg-card cursor-pointer transition-colors border-y border-border/50 select-none"
                      >
                        <td
                          colSpan={4}
                          className="px-4 py-1 text-center text-[11px] text-foreground-subtle/70"
                        >
                          ⋯ 点击展开 {block.count} 行未变更代码 ⋯
                        </td>
                      </tr>
                    );
                  }

                  return block.lines.map((line, lIdx) => {
                    const isAdd = line.type === "add";
                    const isDel = line.type === "delete";
                    const rowBg = isAdd
                      ? "bg-success-soft/70 text-success-fg border-l-2 border-success-border"
                      : isDel
                      ? "bg-danger-soft/70 text-danger-fg border-l-2 border-danger-border opacity-90"
                      : "hover:bg-card/40 text-foreground";

                    return (
                      <tr key={`u-${bIdx}-${lIdx}`} className={`leading-5 ${rowBg}`}>
                        <td className="w-10 px-2 py-0.5 text-right text-foreground-subtle/50 select-none border-r border-border/30">
                          {line.oldLineNumber ?? ""}
                        </td>
                        <td className="w-10 px-2 py-0.5 text-right text-foreground-subtle/50 select-none border-r border-border/30">
                          {line.newLineNumber ?? ""}
                        </td>
                        <td className="w-4 px-1 text-center select-none font-bold">
                          {isAdd ? "+" : isDel ? "-" : " "}
                        </td>
                        <td className="px-2 py-0.5 whitespace-pre font-mono">
                          {line.text || " "}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          ) : (
            /* Split 双栏模式 */
            <div className="grid grid-cols-2 divide-x divide-border">
              {/* 左侧：原文件/删除 */}
              <div className="overflow-x-auto">
                <div className="px-3 py-1 bg-card/40 border-b border-border text-[11px] text-foreground-subtle font-sans">
                  变更前 (Original)
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {diffLines
                      .filter((l) => l.type === "normal" || l.type === "delete")
                      .map((line, idx) => (
                        <tr
                          key={`left-${idx}`}
                          className={`leading-5 ${
                            line.type === "delete"
                              ? "bg-danger-soft/70 text-danger-fg"
                              : "text-foreground-subtle hover:bg-card/30"
                          }`}
                        >
                          <td className="w-10 px-2 py-0.5 text-right text-foreground-subtle/50 select-none border-r border-border/30">
                            {line.oldLineNumber}
                          </td>
                          <td className="px-2 py-0.5 whitespace-pre font-mono">
                            {line.text || " "}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* 右侧：新文件/新增 */}
              <div className="overflow-x-auto">
                <div className="px-3 py-1 bg-card/40 border-b border-border text-[11px] text-foreground-subtle font-sans">
                  变更后 (Modified)
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {diffLines
                      .filter((l) => l.type === "normal" || l.type === "add")
                      .map((line, idx) => (
                        <tr
                          key={`right-${idx}`}
                          className={`leading-5 ${
                            line.type === "add"
                              ? "bg-success-soft/70 text-success-fg font-medium"
                              : "text-foreground-subtle hover:bg-card/30"
                          }`}
                        >
                          <td className="w-10 px-2 py-0.5 text-right text-foreground-subtle/50 select-none border-r border-border/30">
                            {line.newLineNumber}
                          </td>
                          <td className="px-2 py-0.5 whitespace-pre font-mono">
                            {line.text || " "}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
