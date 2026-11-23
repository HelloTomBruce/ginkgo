import React from "react";
import { ComponentSafeWrapper } from "./ComponentSafeWrapper";

export interface LayoutZoneHelper {
  zone: (v: unknown, slotName?: string) => React.ReactNode;
}

/**
 * 创建高容错、防静默吞错的模板插槽解析函数。
 * 1. 严格判空：对 null / undefined 短路，避免向底层 renderNode 传递空值；
 * 2. 捕获内部异常：若某个子组件 AST 解析或物化崩溃，就地降级为友好提示卡，不向外冒泡引发死循环；
 * 3. 避免静默丢失：提示用户具体是哪个插槽（slot）渲染异常。
 */
export function createSafeZone(
  renderNode?: (node?: unknown) => React.ReactNode,
  layoutName = "Layout"
): (v: unknown, slotName?: string) => React.ReactNode {
  return (v: unknown, slotName?: string): React.ReactNode => {
    if (v == null || !renderNode) return null;
    try {
      return renderNode(v);
    } catch (err) {
      console.warn(`[${layoutName}] zone "${slotName || "unknown"}" render error:`, err);
      return (
        <div
          data-testid="zone-error-fallback"
          className="p-3 my-1 bg-warning-soft/60 border border-warning-border rounded-xl text-xs text-warning-fg-strong flex items-center justify-between"
        >
          <span>
            ⚠️ {layoutName} 的「{slotName || "内容"}」区块解析失败，请检查数据格式。
          </span>
        </div>
      );
    }
  };
}

/**
 * 高阶包装函数：为所有 LayoutDef.component 提供统一顶层执行守卫与 ComponentSafeWrapper 包装
 */
export function renderSafeLayout(
  name: string,
  fn: (zone: (v: unknown, slotName?: string) => React.ReactNode) => React.ReactNode,
  renderNode?: (node?: unknown) => React.ReactNode
): React.ReactNode {
  try {
    const zone = createSafeZone(renderNode, name);
    return <ComponentSafeWrapper name={name}>{fn(zone)}</ComponentSafeWrapper>;
  } catch (err) {
    console.warn(`[${name}Def execute error]:`, err);
    return (
      <div className="p-3 bg-warning-soft/50 border border-warning-border/60 rounded-xl text-xs text-warning-fg-strong">
        ⚠️ {name} 模板加载异常，可在新内容到达时自动恢复
      </div>
    );
  }
}
