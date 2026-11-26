import { KNOWN_APP_CAPABILITIES, type AppPackageDefinition } from "@ginkgo/app-sdk";
import analyticsAppPackage from "@ginkgo/app-analytics";
import generalAppPackage from "@ginkgo/app-general";
import designAppPackage from "@ginkgo/app-design";
import { DEFAULT_APPS_CONFIG } from "./defaultAppsConfig";

/**
 * 默认主应用 ID（用于向后兼容未指定 appId 的旧会话）
 */
export const DEFAULT_APP_ID = "analytics";

export interface AppConfigEntry {
  id: string;
  name?: string;
  package?: string;
  enabled?: boolean;
  builtin?: boolean;
  /** 安装时用户确认过的权限集合（审计留痕，不参与运行时判定） */
  permissions?: string[];
}

export interface AppConfigFile {
  apps: AppConfigEntry[];
}

/**
 * 内置标准应用包字典
 */
export const BUILTIN_APP_PACKAGES: Record<string, AppPackageDefinition> = {
  analytics: analyticsAppPackage,
  general: generalAppPackage,
  design: designAppPackage,
};

export class AppRegistry {
  private apps: Map<string, AppPackageDefinition> = new Map();
  private enabledStates: Map<string, boolean> = new Map();
  private appOrder: string[] = [];

  constructor(config: AppConfigFile = DEFAULT_APPS_CONFIG) {
    this.initFromConfig(config);
  }

  /**
   * 基于配置**重置**注册表（幂等）。
   *
   * 仅供进程启动引导使用：会清空已注册应用、启用态与顺序后重放配置。
   * 运行期改启用态请走 `setEnabled`，不要调用本方法。
   */
  public initFromConfig(config: AppConfigFile): void {
    this.apps.clear();
    this.enabledStates.clear();
    this.appOrder = [];

    const entries = Array.isArray(config?.apps) ? config.apps : [];

    for (const entry of entries) {
      if (!entry.id) continue;
      this.appOrder.push(entry.id);
      this.enabledStates.set(entry.id, entry.enabled !== false);

      // 若为已知内置应用，自动注册
      if (BUILTIN_APP_PACKAGES[entry.id]) {
        this.register(BUILTIN_APP_PACKAGES[entry.id], {
          enabled: entry.enabled !== false,
        });
      }
    }

    // 保证内置默认应用必定注册兜底
    if (!this.apps.has(DEFAULT_APP_ID) && BUILTIN_APP_PACKAGES[DEFAULT_APP_ID]) {
      this.register(BUILTIN_APP_PACKAGES[DEFAULT_APP_ID], { enabled: true });
    }
  }

  /**
   * 注册应用包（同时校验 requiredCapabilities 词汇表：
   * 未知能力仅告警不拦截——前向兼容第三方应用，防拼写漂移）
   */
  register(
    app: AppPackageDefinition,
    options?: { enabled?: boolean; index?: number }
  ): void {
    const id = app.manifest.id;
    this.apps.set(id, app);

    if (options?.enabled !== undefined) {
      this.enabledStates.set(id, options.enabled);
    } else if (!this.enabledStates.has(id)) {
      this.enabledStates.set(id, true);
    }

    if (!this.appOrder.includes(id)) {
      if (typeof options?.index === "number" && options.index >= 0) {
        this.appOrder.splice(options.index, 0, id);
      } else {
        this.appOrder.push(id);
      }
    }

    for (const cap of app.server.requiredCapabilities ?? []) {
      if (!(KNOWN_APP_CAPABILITIES as readonly string[]).includes(cap)) {
        console.warn(
          `[registry] 应用 [${id}] 声明了平台未知的底层能力 "${cap}"，` +
            `请检查拼写或在 @ginkgo/app-sdk 的 KNOWN_APP_CAPABILITIES 中扩充词汇表`
        );
      }
    }
  }

  /**
   * 动态设置应用的启用状态
   */
  setEnabled(id: string, enabled: boolean): boolean {
    if (!this.apps.has(id)) return false;
    this.enabledStates.set(id, enabled);
    return true;
  }

  /**
   * 检查应用是否启用
   */
  isAppEnabled(id: string): boolean {
    return this.apps.has(id) && this.enabledStates.get(id) !== false;
  }

  /**
   * 获取已注册应用（**不论启用态**）。
   *
   * 只用于「这个 id 是否被注册」这类注册态判断；任何**执行**路径
   * （工具装配、动作分发、运行时服务解析）必须用 `getEnabled`，
   * 否则停用只是 UI 假象。
   */
  get(id: string): AppPackageDefinition | undefined {
    return this.apps.get(id);
  }

  /**
   * 获取已启用应用：未注册或已停用均返回 undefined（执行路径唯一入口）。
   */
  getEnabled(id: string): AppPackageDefinition | undefined {
    if (!this.isAppEnabled(id)) return undefined;
    return this.apps.get(id);
  }

  /**
   * 注销应用：同时清除注册项、启用态与顺序位。
   *
   * 卸载流程必须调用，否则「已卸载」的应用仍能通过 `has()` 通过守卫，
   * 继续被动作网关分发（参见 packageManager.uninstallPackage）。
   */
  unregister(id: string): boolean {
    const existed = this.apps.delete(id);
    this.enabledStates.delete(id);
    this.appOrder = this.appOrder.filter((item) => item !== id);
    return existed;
  }

  /**
   * 获取指定应用，不存在或已禁用则兜底返回默认应用（analytics）
   */
  getOrDefault(id?: string | null): AppPackageDefinition {
    if (id && this.apps.has(id) && this.isAppEnabled(id)) {
      return this.apps.get(id)!;
    }
    return this.apps.get(DEFAULT_APP_ID) ?? analyticsAppPackage;
  }

  /**
   * 列出所有已注册且已启用的应用包（严格按配置顺序）
   */
  list(): AppPackageDefinition[] {
    const result: AppPackageDefinition[] = [];
    for (const id of this.appOrder) {
      const app = this.apps.get(id);
      if (app && this.enabledStates.get(id) !== false) {
        result.push(app);
      }
    }
    // 补齐可能在 appOrder 之外动态 register 的应用
    for (const [id, app] of this.apps.entries()) {
      if (!this.appOrder.includes(id) && this.enabledStates.get(id) !== false) {
        result.push(app);
      }
    }
    return result;
  }

  /**
   * 全部已注册 id（含已停用），顺序与 list() 一致。
   * 用于诊断/引导报告——`list()` 只返回启用项，无法表达「注册了但停用」。
   */
  getRegisteredIds(): string[] {
    return this.list().map((app) => app.manifest.id).concat(
      this.appOrder.filter(
        (id) => this.apps.has(id) && this.enabledStates.get(id) === false
      )
    );
  }

  /**
   * 检查某个应用是否已注册
   */
  has(id: string): boolean {
    return this.apps.has(id);
  }
}

/**
 * 全局应用注册表单例
 */
export const appRegistry = new AppRegistry();

/**
 * 获取默认应用
 */
export function getDefaultApp(): AppPackageDefinition {
  return appRegistry.getOrDefault(DEFAULT_APP_ID);
}

/**
 * 按 ID 获取应用
 */
export function getApp(id: string): AppPackageDefinition | undefined {
  return appRegistry.get(id);
}

/**
 * 获取所有可用应用列表
 */
export function listApps(): AppPackageDefinition[] {
  return appRegistry.list();
}
