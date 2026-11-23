import type { TransformSpec } from "./transforms";

/**
 * 看板收藏记录的领域类型（isomorphic：宿主收藏链路与 analytics 服务端共用）。
 * 实现约束（长度/条数上限与 IO）在 server 侧 store，本模块只承载形状。
 */

export interface DashboardOrigin {
  sessionId?: string;
  messageId?: string;
}

/**
 * 活看板取数查询（P2-A）：收藏时从 execute 轮工具调用记录捕获。
 * kind=sql → payload 为 SQL 文本（db 类源重放）；kind=tool → payload 为
 * {"tool","args"} JSON 串（MCP 类源重放）。
 */
export interface DashboardQuery {
  /** q_ 前缀；由 (sourceId, kind, payload) 散列决定，同查询幂等 */
  id: string;
  sourceId: string;
  kind: "sql" | "tool";
  payload: string;
}

/** 记录形态：收藏看板（默认）/ 报表模板（可换源复用） */
export type DashboardKind = "favorite" | "template";

/** 模板槽位：重绑定时的字段角色声明（M3 数据层） */
export interface TemplateSlot {
  /** 绑定键（DSL 组件 statementId） */
  bindingKey: string;
  role: "source" | "filter";
  required?: boolean;
}

/** 模板元数据：kind=template 时必填 */
export interface TemplateMeta {
  /** 抽象化提问（用模板新建时的种子 prompt，去除具体值） */
  abstractPrompt: string;
  /** 槽位清单（可空 = 仅换源语义） */
  slots?: TemplateSlot[];
}

export interface DashboardRecord {
  id: string;
  /** 产物归属应用 id（平台产物协议；存量记录读时归一为 analytics） */
  appId?: string;
  title: string;
  /** 记录形态；缺省 = favorite（向后兼容旧记录） */
  kind?: DashboardKind;
  /** 模板元数据（kind=template 时必填） */
  templateMeta?: TemplateMeta;
  /** 看板 DSL 快照全文（收藏时刻的静态数据） */
  dsl: string;
  /** 生成该看板的用户提问（重新分析的种子；可空） */
  prompt?: string;
  /** 生成时启用源的名称快照，仅展示归档（不含 id/凭据） */
  sourceNames?: string[];
  /** 重复收藏 upsert 依据 */
  origin?: DashboardOrigin;
  /** 活看板：被看板组件直接引用的取数查询（derived 组件不绑定；可空 = 旧快照只读） */
  queries?: DashboardQuery[];
  /** 活看板：DSL 组件 statementId → queries[].id（值必引 queries 内存在的 id） */
  bindings?: Record<string, string>;
  /** 派生变换绑定：statementId → 确定性变换 spec（键必 ⊆ bindings 键；刷新时重放后重算） */
  transforms?: Record<string, TransformSpec>;
  /** 数据确认时间：收藏捕获时 = 生成时刻；刷新成功后更新（后续任务） */
  dataUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 列表摘要：不含 dsl 全文 */
export type DashboardSummary = Omit<DashboardRecord, "dsl">;
