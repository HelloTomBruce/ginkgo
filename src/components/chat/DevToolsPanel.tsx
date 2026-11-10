"use client";

import React from "react";
import { X, Code2 } from "lucide-react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface DevToolsPanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  onAction: (msg: string) => void;
  onClose: () => void;
}

export function DevToolsPanel({ code, onCodeChange, onAction, onClose }: DevToolsPanelProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="no-print max-w-[calc(100%-2rem)] sm:max-w-5xl h-[85vh] w-full p-0 gap-0 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-4 border-b border-border flex items-center justify-between bg-surface-sunken">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-brand-fg" />
            <div>
              <DialogTitle className="font-bold text-sm text-left">
                OpenUI DevTools & 实时 AST 调试沙箱
              </DialogTitle>
              <p className="text-[11px] text-foreground-faint">
                可在此直接修改 OpenUI Lang 代码，实时验证语法解析、响应式变量计算与组件渲染
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭 DevTools"
            className="p-1 rounded-md text-foreground-faint hover:text-foreground-subtle hover:bg-surface-raised"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* 左侧 DSL 实时编辑器 */}
          <div className="w-1/2 border-r border-border flex flex-col p-4 bg-surface-inverse text-surface-inverse-foreground">
            <div className="flex items-center justify-between pb-2 text-xs font-mono text-foreground-faint">
              <span>OpenUI Lang Source Editor</span>
              <span className="text-[10px] text-brand-fg font-sans">毫秒级热编译</span>
            </div>
            <textarea
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              className="flex-1 w-full bg-transparent font-mono text-xs leading-relaxed focus:outline-none resize-none text-surface-inverse-foreground"
              spellCheck={false}
            />
          </div>

          {/* 右侧实时视觉预览区 */}
          <div className="w-1/2 flex flex-col p-4 overflow-y-auto bg-surface-sunken">
            <div className="pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Live Preview Output
            </div>
            <OpenUIRenderer
              content={code}
              isStreaming={false}
              onAction={onAction}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
