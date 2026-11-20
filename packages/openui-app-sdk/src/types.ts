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

  /** 获取当前工作区产物列表（由应用自理实现，可选） */
  listArtifacts?: (ctx: AppWorkspaceContext) => Promise<AppArtifactItem[]>;
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
  type: string; // 如 "dashboard" | "file" | "document" | "script"
  path?: string;
  sizeBytes?: number;
  updatedAt: number;
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
  /** 启用的数据源摘要清单（可选） */
  activeSources?: Array<{ id: string; name: string }>;
  /** 方法论清单文本（可选） */
  methodologyText?: string;
  /** 用户前序消息上下文 */
  messages?: unknown[];
}

export interface AppServerContract {
  /**
   * 应用自治的 System Prompt 生成器。
   * 每个应用包全权负责编写自己的角色设定、业务指令、Few-shot 示例或格式约束。
   */
  buildSystemPrompt: (ctx: AppServerContext) => Promise<string> | string;

  /**
   * 应用自治声明并装配的工具集（Tools）。
   * 属于应用的底层能力（如数据库探查 SQL、文件提取等）在此自理，不泄漏给宿主。
   */
  getTools?: (ctx: AppServerContext) => Promise<Record<string, unknown>> | Record<string, unknown>;

  /** 是否需要挂载数据库探查工具（标志位） */
  requiresDataTools?: boolean;

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
