import type { ComponentType } from "react";

/**
 * @ginkgo/app-sdk
 *
 * UiSpec 平台应用规范协议底座。
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

/** 工作区上下文详细信息（由宿主注入给插槽组件） */
export interface AppWorkspaceContextInfo {
  /** 工作区 ID */
  id?: string;
  /** 工作区显示名称 */
  name?: string;
  /** 本地绑定工程物理路径（若绑定外部目录） */
  path?: string;
  /** 实际沙箱物理根目录（绝对路径） */
  sandboxDir: string;
  /** 是否为 Git 仓库 */
  isGitRepo?: boolean;
}

/** 宿主注入给右侧工作台插槽的 Props */
export interface AppWorkspaceProps {
  /** 当前工作区的数据产物（如看板 DSL、文档内容、沙箱代码等） */
  data: unknown;
  /** 当前会话 ID */
  sessionId?: string;
  /** 当前应用 ID */
  appId?: string;
  /** 宿主统一注入的工作区上下文 */
  workspace?: AppWorkspaceContextInfo;
  /** 关闭工作台回到纯对话流 */
  onClose: () => void;
  /** 交互动作回调（如点击操作建议按钮反馈给模型） */
  onAction?: (actionPrompt: string) => void;
  /** 刷新画布/产物回调 */
  onRefresh?: (id?: string) => void | Promise<void>;
  /** 打印/导出回调（可携带目标产物 ID，宿主可忽略参数） */
  onPrint?: (id?: string) => void;
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
  /** 触发快捷操作的回调（与 Component 二选一：宿主内置能力 key 或应用自治弹层） */
  onClick?: () => void;
  /**
   * 应用自治弹层组件（可选）：提供时由宿主统一管理 open 状态并渲染，
   * 应用完全自治弹层内容（如方法论查看器）。
   */
  Component?: ComponentType<{ open: boolean; onClose: () => void }>;
}

/** 宿主注入给设置中心应用分区的 Props */
export interface AppSettingsSectionProps {
  /** 当前应用 ID */
  appId: string;
  /**
   * 宿主签发的请求函数：语义同全局 fetch，并自动附加部署鉴权头
   * （网关鉴权模式下 /api/* 须携带访问令牌，令牌存储归宿主，应用包不感知）。
   * 分区的读写请求一律经此发起，勿直接调用 fetch。
   */
  request: (path: string, init?: RequestInit) => Promise<Response>;
  /** 其它扩展 Props */
  [key: string]: unknown;
}

/**
 * 设置中心应用分区声明：宿主设置弹窗在平台 tab 之后按声明追加，仅渲染当前应用的分区。
 * 分区内容与持久化由应用完全自治（即时保存语义，不经宿主底部「保存配置」）。
 */
export interface AppSettingsSectionSpec {
  key: string;
  label: string;
  icon?: string;
  /** 分区内容组件 */
  Component: ComponentType<AppSettingsSectionProps>;
}

/**
 * 画布钉选载荷（平台渲染基建概念）：宿主把消息内看板区块钉选到右侧
 * 工作台时传递的数据，由应用的工作台插槽组件消费。
 */
export interface AppCanvasData {
  /** 来源消息 id（钉选唯一键） */
  id: string;
  title?: string;
  /** 看板 DSL 全文 */
  dsl: string;
  /** 是否为活看板（携带可重放查询，支持零 LLM 刷新） */
  isLive?: boolean;
}

/**
 * 平台内置的通用展示渲染器类型
 * - "diff": 代码/文本差异比对视图（支持 unified / split 切换、折叠、高亮）
 * - "terminal": 终端命令执行与输出卡片（仿终端样式、命令回显、退出码、输出折叠）
 * - "approval": 权限与高危操作人机审批卡
 * - "json": 格式化 JSON 树形折叠预览
 */
export type BuiltinToolRendererType = "diff" | "terminal" | "approval" | "json";

/** 模式提权拟变更项目 */
export interface ModeEscalationChangeItem {
  type: "file_create" | "file_modify" | "dependency_install" | "command" | "database";
  target: string;
  description?: string;
}

/** 模式提权申请载荷 */
export interface ModeEscalationPayload {
  targetMode: "build";
  summary: string;
  changes?: ModeEscalationChangeItem[];
  riskLevel?: "low" | "medium" | "high";
  actionPrompt?: string;
}

/** 工具调用展示渲染器声明 */
export interface AppToolRendererSpec {
  /** 匹配的工具名称（如 "edit_file", "run_command"） */
  toolName: string;
  /** 使用平台内置的渲染器或自定义组件 */
  renderer: BuiltinToolRendererType | ComponentType<unknown>;
  /** 是否默认展开内容体 */
  defaultOpen?: boolean;
  /** 自定义卡片标题 */
  title?: string;
}

/** 人机协同审批规则声明（Human-in-the-Loop） */
export interface AppToolApprovalRule {
  /** 需要拦截审批的工具名称（如 "run_command", "write_file", "execute_sql"） */
  toolName: string;
  /** 风险级别：决定卡片视觉警告程度 */
  riskLevel: "info" | "warning" | "danger";
  /** 审批动作标题，如「终端命令执行确认」或「核心文件覆写确认」 */
  title: string;
  /**
   * 触发审批的条件谓词（可选）：
   * 不配置时全量拦截；配置时仅在特定参数下拦截（如匹配到某些高危命令或路径）
   */
  condition?: (args: Record<string, unknown>) => boolean;
  /** 拒绝时的默认反馈提示词 */
  defaultRejectFeedback?: string;
}

/**
 * 消息区扩展声明：宿主消息时间线按声明渲染应用语义的兜底卡与提示，
 * 宿主零应用语义（禁止话术正则与 appId 特判）。
 */
export interface AppMessageExtensions {
  /**
   * 规划确认兜底：最后一条 assistant 消息无看板代码且文本包含任一
   * pattern（子串匹配）时渲染确认按钮，点击发送 actionPrompt。
   */
  planConfirm?: {
    /** 触发短语（子串匹配，来自应用 prompt 对模型输出话术的硬性要求） */
    patterns: string[];
    /** 确认按钮文案 */
    label: string;
    /** 点击后作为用户消息发送的执行指令 */
    actionPrompt: string;
  };
  /**
   * 终态闭环兜底：finish_task 已执行且消息无看板代码时渲染总结卡，
   * 展示 finish_task 的 summary 并提供一键生成按钮。
   */
  completion?: {
    /** 卡片标题（如「数据取数与分析计算已全部完成」） */
    title: string;
    /** 一键生成按钮文案 */
    buttonLabel: string;
    /** 点击后作为用户消息发送的生成指令 */
    actionPrompt: string;
  };
  /** 流式中工具完成后的过渡文案；缺省「工具执行完成，正在组织回复...」 */
  toolSettledHint?: string;
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
  /** 新会话默认标题（未声明时宿主兜底为「新建会话」） */
  defaultSessionTitle?: string;
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

  /**
   * 设置中心应用分区插槽：宿主在平台 tab（模型/数据源/…）之后按声明追加，
   * 仅渲染当前应用声明的分区。平台级、跨应用共享的配置（模型、数据源、MCP）
   * 归宿主与能力包，不在此声明；应用领域自有配置（如跨源映射）经此提供界面。
   */
  settingsSections?: AppSettingsSectionSpec[];

  /**
   * 消息内看板区块的工具条能力声明（能力注入）：
   * 未声明的应用不渲染任何操作按钮（钉选/收藏/导出 PDF 均按需开启），
   * 工具条标题也可由应用定制。
   */
  dashboardToolbar?: {
    /** 工具条标题文案，缺省「动态看板」 */
    title?: string;
    /** 钉选到右侧画布协同查看 */
    pin?: boolean;
    /** 收藏到看板收藏库（需配合 sidebarTabs 的 dashboards tab 完整体验） */
    favorite?: boolean;
    /** 浏览器打印 / 另存为 PDF */
    exportPdf?: boolean;
  };

  /**
   * 工作区视图语义：canvas=分析画布（canvas-only 模式需先有钉选看板，
   * 文案为「画布」）；files=文件产物工作台（缺省，文案为「全屏」）。
   */
  workspaceView?: "canvas" | "files";

  /** 会话支持挂载本地文件夹为工作区（侧栏「选择文件夹」按钮的渲染开关） */
  workspaceMount?: boolean;

  /** 消息区扩展声明（兜底卡/确认按钮/过渡文案），宿主零应用语义渲染 */
  messageExtensions?: AppMessageExtensions;

  /**
   * 工具调用展示渲染器映射：声明特定工具调用使用高级通用组件渲染
   * （如 edit_file 走 diff，run_command 走 terminal）；未声明则回退轻量徽标
   */
  toolRenderers?: AppToolRendererSpec[];

  /**
   * 人机协同审批规则：声明需要人工确认的高危操作（如高危终端命令、核心文件覆写）
   */
  approvalRules?: AppToolApprovalRule[];

  /**
   * 推荐列表运行时解析插槽（如方法卡内置 + /api 合并卡集）。
   * 提供时宿主以其 resolved 结果为推荐列表唯一来源；缺省用静态 presetQueries。
   * 设计为异步 resolver 而非 hook：宿主在 effect 中按应用条件调用，
   * 避免「应用是否声明」造成的条件 hook 调用违规。
   */
  resolvePresetQueries?: () => Promise<AppPresetQuery[]>;
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
  /** 交付物证据标记：任一出现即视为「有可视化交付物」（如 ["```ginkgo", "PlanReviewCard"]） */
  evidenceMarkers?: string[];
}

export interface AppActionContext {
  /** 当前应用 ID */
  appId: string;
  /** 会话 ID */
  sessionId: string;
  /** 经平台安全归一化后的工作区根目录（绝对路径） */
  workspaceDir: string;
  /** 调用方身份（可选，多租户/网关鉴权模式） */
  principal?: string;
  /** 租户 ID（可选） */
  tenantId?: string;
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
   * 声明应用需要会话工作区（标志位）：宿主据此解析沙箱并注入
   * AppServerContext.workspace（sandboxDir / customRootDir），供
   * buildSystemPrompt / getTools 消费。未声明则不解析（无沙箱语义的应用
   * 不产生无谓的目录创建）。
   */
  needsWorkspace?: boolean;

  /**
   * 应用自治动作分发网关（RPC 通道，可选）：
   * 承接右侧工作台、自定义设置分区、插件扩展等发起的前后端专用交互指令
   * （如画板服务启停、Token 审查、复杂数据重算等）。
   * 宿主通过通用网关 /api/apps/[appId]/action 自动校验并转发到此，
   * 彻底杜绝在宿主基座为每个应用手写业务 API 路由。
   */
  dispatchAction?(
    action: string,
    payload: Record<string, unknown>,
    ctx: AppActionContext
  ): Promise<unknown>;

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
