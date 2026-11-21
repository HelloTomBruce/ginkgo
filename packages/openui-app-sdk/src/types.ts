import type { ComponentType } from "react";

/**
 * @openui-analytics/app-sdk
 *
 * OpenUI 平台应用规范协议底座。
 * 遵循「外层暴露插槽 (Slots)，应用声明扩展点；能力归属于应用」的设计哲学。
 */

export interface AppManifest {
  /** 唯一标识，如 "analytics", "general", "devops" */
  id: string;
  /** 应用展示名，如 "智能数据分析师", "通用智能助手" */
  name: string;
  /** 简要描述 */
  description: string;
  /** 图标标识（支持 Lucide 图标名） */
  icon: string;
  /** 版本号 */
  version?: string;
  /** 业务分类，如 "数据智能", "通用助理", "研发效能" */
  category?: string;
  /** 标签 */
  tags?: string[];
  /** 作者或团队 */
  author?: string;
}

export interface AppPresetQuery {
  /** 推荐问题或指令文本 */
  text: string;
  /** 所属类别 */
  category?: string;
  /** 关联的方法卡 id 或快捷标记 */
  id?: string;
}

/** 宿主注入给右侧工作台插槽的 Props */
export interface AppWorkspaceProps {
  /** 当前工作区的数据产物（如看板 DSL、文档内容、沙箱代码等） */
  data: unknown;
  /** 关闭工作台回到纯对话流 */
  onClose: () => void;
  /** 交互动作回调（如点击操作建议按钮反馈给模型） */
  onAction?: (actionPrompt: string) => void;
  /** 是否全屏最大化展示 */
  isExpanded?: boolean;
  /** 切换全屏/还原 */
  onToggleExpand?: () => void;
  /** 其它扩展 Props */
  [key: string]: unknown;
}

/** 宿主注入给输入栏辅助插槽的 Props */
export interface AppInputAccessoryProps {
  /** 当前会话 ID */
  sessionId?: string;
  /** 当前选中的数据源或配置项 */
  selected?: string[];
  /** 状态改变回调 */
  onChange?: (values: string[]) => void;
  /** 是否只读锁定 */
  disabled?: boolean;
  /** 其它扩展 Props */
  [key: string]: unknown;
}

/** 宿主注入给侧边栏扩展 Tab 面板组件的 Props */
export interface AppSidebarTabProps {
  /** 当前应用 ID */
  appId: string;
  /** 点击推荐项/快捷指令填入输入框回调 */
  onSelectPrompt?: (prompt: string) => void;
  /** 其它扩展 Props */
  [key: string]: unknown;
}

/** 侧边栏扩展 Tab 声明 */
export interface AppSidebarTabSpec {
  key: string;
  label: string;
  icon?: string;
  /** 描述文案或副标题（如用于预设面板顶部） */
  description?: string;
  /** Tab 内容组件（可选，提供时完全由应用自治接管渲染） */
  Component?: ComponentType<AppSidebarTabProps>;
}

/** 侧边栏底部快捷操作声明 */
export interface AppSidebarQuickActionSpec {
  key: string;
  label: string;
  icon?: string;
  /** 触发快捷操作的回调 */
  onClick?: () => void;
}

/**
 * 通用交互模式：
 * - "plan": 方案规划模式（先探查/思考/拆解方案，经用户审阅确认后再执行）
 * - "build": 直接构建模式（跳过前期规划，直接执行并交付最终产物）
 */
export type InteractionMode = "plan" | "build";

/**
 * 客户端扩展插槽（Slots）与交互契约
 * 外层宿主只负责暴露 Slot，业务特有组件由应用包自己提供并挂载
 */
export interface AppClientContract {
  /** 新会话默认欢迎语 */
  welcomeMessage: string;
  /** 推荐场景问题列表 */
  presetQueries: AppPresetQuery[];
  /** 默认交互模式（未指定时默认为 "plan"） */
  defaultInteractionMode?: InteractionMode;

  // ===== 核心组件插槽 (Component Slots) =====
  /**
   * 应用专属工作台插槽组件（Workspace Slot Component）。
   * 数据分析包提供其内部的 AnalysisCanvas；
   * 文档写作包提供其内部的 DocumentEditor；
   * 通用助手包为 undefined（宿主自然不渲染右侧栏，纯对话居中）。
   */
  WorkspaceComponent?: ComponentType<AppWorkspaceProps>;

  /**
   * 输入框辅助挂件插槽组件（Input Accessory Slot Component）。
   * 数据分析包提供其内部的 SourcePicker；
   * 通用助手包为 undefined（输入框保持极简纯净）。
   */
  InputAccessoryComponent?: ComponentType<AppInputAccessoryProps>;

  /** 是否开启工作区支持（标志位，方便快速判定） */
  hasWorkspace?: boolean;
  /** 工作台标题 */
  workspaceTitle?: string;
  /** 是否开启输入栏辅助挂件支持（标志位，如数据源选择器） */
  hasInputAccessory?: boolean;

  /** 侧边栏扩展 Tab 列表 */
  sidebarTabs?: AppSidebarTabSpec[];

  /** 侧边栏底部操作列表 */
  sidebarQuickActions?: AppSidebarQuickActionSpec[];
}

/**
 * 通用工作区运行时上下文，宿主为每次会话/操作注入
 */
export interface AppWorkspaceContext {
  /** 当前应用 ID */
  appId: string;
  /** 会话 ID */
  sessionId?: string;
  /** 物理沙箱绝对路径（如 data/workspaces/{appId}/{sessionId}） */
  sandboxDir: string;
  /** 用户绑定的外部工程路径（可选） */
  customRootDir?: string;
}

/**
 * 产物元数据抽象（不限格式，由应用自治解释与展示）
 */
export interface AppArtifactItem {
  id: string;
  name: string;
  /** 产物类型：平台约定值 "dashboard" | "file" | "document" | "script"，应用可自定义 */
  type: string;
  path?: string;
  sizeBytes?: number;
  updatedAt: number;
}

/**
 * 产物刷新裁决（活产物协议）：应用按自身语义重算产物数据（如重放取数查询），
 * 平台路由负责持久化。compute-only——不落盘。
 */
export type AppArtifactRefreshVerdict =
  | {
      ok: true;
      /** 刷新后的产物载荷（如回填后的新 DSL 全文） */
      payload: string;
      /** 部分成功的组件/区块 id（保留旧数据） */
      stale?: string[];
      /** 新数据时间戳（全部成功时由应用给出） */
      dataUpdatedAt?: number;
    }
  | {
      ok: false;
      /** 归一失败原因：readonly | not-found | unsupported | source-unavailable | replay-failed | dsl-invalid | 应用自定义 */
      reason: string;
      error?: string;
    };

/**
 * 会话上下文元数据（宿主会话存储中的治理锚点与应用编排状态）。
 * 字段由宿主（token 锚点/摘要缓存）与应用（如规划待执行状态）共同扩展，
 * 此处声明分析类应用常用的最小集合，其余字段经索引签名透传。
 */
export interface AppSessionContextMeta {
  /** 最近一次实测 prompt token 锚点（宿主写入，应用只读） */
  lastPromptTokens?: number;
  /** 摘要缓存标记：摘要已覆盖到该消息（宿主读写） */
  summaryUptoMessageId?: string;
  /** 缓存的会话摘要文本（宿主读写） */
  summary?: string;
  /** 规划待执行状态：plan 阶段产出、execute 阶段消费（应用读写，如方法卡 id 列表） */
  pendingPlan?: { methodIds?: string[] } & Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 会话上下文读写通道（宿主注入）：应用编排状态（如 pendingPlan）的
 * 持久化经此通道落盘，update 为增量合并语义。
 */
export interface AppSessionContextChannel {
  getContext(sessionId: string): Promise<AppSessionContextMeta | undefined>;
  updateContext(sessionId: string, patch: Partial<AppSessionContextMeta>): Promise<void>;
}

export interface AppServerContext {
  /** 当前应用 ID */
  appId?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 工作区运行时上下文（物理沙箱目录与权限边界） */
  workspace?: AppWorkspaceContext;
  /** 交互模式：普通直接回复 direct / 规划模式 plan / 执行确认模式 execute */
  mode?: "direct" | "plan" | "execute";
  /** 数据源信息摘要文本（可选） */
  schemaDigestText?: string;
  /** 平台装载的源摘要清单（可选；当前为 MCP 源，含已装载工具名，供应用 prompt 渲染数据访问段） */
  activeSources?: Array<{ id: string; name: string; kind?: string; tools?: string[] }>;
  /** 方法论清单文本（可选） */
  methodologyText?: string;
  /** 用户前序消息上下文 */
  messages?: unknown[];
  /** 最新用户提问文本（可选；语义召回/认证口径匹配等用途） */
  userQuery?: string;
  /** 当前会话启用的数据源 id 列表（可选；requiresDataTools 类应用装配工具用） */
  enabledSources?: string[];
  /** 会话上下文读写通道（可选；应用编排状态如 pendingPlan 的持久化） */
  sessions?: AppSessionContextChannel;
}

/**
 * 应用交付物契约：宿主编排层（如 finish_task 终态不变量）据此适配
 * 应用领域的交付物语义。全部可选——未提供的字段由宿主使用中立缺省。
 */
export interface AppDeliverableContract {
  /** finish_task 终态工具描述（应用领域语境） */
  toolDescription?: string;
  /** 无任何产出证据时拒绝 completed 的文案 */
  rejectReason?: string;
  /** 存在可视化交付物时的收尾指令 */
  wrapUpWithArtifact?: string;
  /** 仅有文本产出时的收尾指令 */
  wrapUpPlainText?: string;
  /** 交付物证据标记：任一出现即视为「有可视化交付物」（如 ["```openui", "PlanReviewCard"]） */
  evidenceMarkers?: string[];
}

export interface AppServerContract {
  /**
   * 应用自治的 System Prompt 生成器。
   * 每个应用包全权负责编写自己的角色设定、业务指令、Few-shot 示例或格式约束。
   * 可选：需要运行时依赖注入的应用（如 analytics 的数据源单例）不在静态包导出上
   * 提供，而由宿主组合根经工厂（createXxxServer(deps)）装配运行时实例。
   */
  buildSystemPrompt?: (ctx: AppServerContext) => Promise<string> | string;

  /**
   * 应用自治声明并装配的工具集（Tools）。
   * 属于应用的底层能力（如数据库探查 SQL、文件提取等）在此自理，不泄漏给宿主。
   */
  getTools?: (ctx: AppServerContext) => Promise<Record<string, unknown>> | Record<string, unknown>;

  /** 是否需要挂载数据库探查工具（标志位） */
  requiresDataTools?: boolean;

  /**
   * 产物列表（可选）：应用自治枚举其产物（看板/文档/文件等）为统一的
   * AppArtifactItem 投影，供宿主产物面板/徽章计数等平台级消费。
   */
  listArtifacts?(
    ctx: AppWorkspaceContext
  ): Promise<AppArtifactItem[]> | AppArtifactItem[];

  /**
   * 活产物刷新（可选）：按应用语义重算产物数据（零 LLM），compute-only 不落盘。
   * 未提供 = 该应用产物不支持数据刷新。
   */
  refreshArtifact?(input: {
    artifactId: string;
  }): Promise<AppArtifactRefreshVerdict>;

  /** 声明依赖的平台底层能力 */
  requiredCapabilities?: string[];
}

/**
 * 完整应用包定义（App Package Definition）
 */
export interface AppPackageDefinition {
  manifest: AppManifest;
  client: AppClientContract;
  server: AppServerContract;
}
