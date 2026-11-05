/**
 * 系统能力注册表（Capability Registry）
 *
 * 产品级能力的唯一事实来源：新功能上线时在 CAPABILITIES 增删条目，
 * 欢迎语、以及后续其它需要「系统能力清单」的入口（关于页/帮助文档）
 * 都从注册表生成，不再各自维护硬编码文案。
 *
 * 注意：这里描述的是产品能力，不是数据源清单——数据源由用户在
 * 「设置 → 数据源」动态配置（见 packages/openui-datasources）。
 */

export interface Capability {
  /** 展示用 emoji 图标 */
  icon: string;
  /** 中文能力名 */
  name: string;
  /** 英文别名（括号内展示） */
  alias: string;
  /**
   * 能力依赖的服务端特性开关（/api/datasources 返回的 features）：
   * 开关为 true 时能力才成立。特性判定在服务端按用户配置完成，
   * 代码不内置任何数据源名。缺省表示无条件（系统内建能力）。
   */
  requiresFeature?: "crossSource";
}

/** 能力判定上下文：已配置数据源 + 服务端特性开关 */
export interface CapabilityContext {
  sources?: SourceRef[];
  features?: { crossSource?: boolean };
}

/** 判定用的最小数据源形态（与 DataSourceDescriptor 结构兼容） */
export interface SourceRef {
  id: string;
  name: string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    icon: "⚡",
    name: "响应式状态与本地毫秒试算",
    alias: "Reactive State",
  },
  {
    icon: "🛠️",
    name: "前端客户端工具直连",
    alias: "Client Tool Provider",
  },
  {
    icon: "📋",
    name: "动作流编排与落地清单",
    alias: "Action Pipelines",
  },
  {
    icon: "🔗",
    name: "跨源联合分析",
    alias: "Cross-Source Insights",
    // 由 cross-source-map.json 的 pair 配置 + 双侧源启用共同决定
    requiresFeature: "crossSource",
  },
  {
    icon: "🔍",
    name: "开发者 AST 实时调试检查台",
    alias: "OpenUI DevTools",
  },
  {
    icon: "📊",
    name: "流式全链路可观测性",
    alias: "Observability Metrics",
  },
] as const;

/** 按能力上下文过滤出当前实际成立的能力 */
export function resolveCapabilities(ctx: CapabilityContext = {}): Capability[] {
  return CAPABILITIES.filter((c) => {
    if (!c.requiresFeature) return true;
    return ctx.features?.[c.requiresFeature] === true;
  });
}

/** 生成「本系统已深度集成」段落（Markdown 列表）；ctx 缺省=无条件能力 */
export function buildCapabilitySection(ctx: CapabilityContext = {}): string {
  const items = resolveCapabilities(ctx)
    .map((c) => `- ${c.icon} **${c.name} (${c.alias})**`)
    .join("\n");
  return `本系统已深度集成：\n${items}`;
}
