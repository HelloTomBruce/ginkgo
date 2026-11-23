import type { AppPackageDefinition } from "@ginkgo/app-sdk";
import analyticsAppPackage from "@ginkgo-apps/analytics";
import generalAppPackage from "@ginkgo-apps/general";

/**
 * 默认主应用 ID（用于向后兼容未指定 appId 的旧会话）
 */
export const DEFAULT_APP_ID = "analytics";

class AppRegistry {
  private apps: Map<string, AppPackageDefinition> = new Map();

  constructor() {
    // 注册标准应用包（每个包来自 packages/apps/*）
    this.register(analyticsAppPackage);
    this.register(generalAppPackage);
  }

  /**
   * 注册应用包
   */
  register(app: AppPackageDefinition): void {
    this.apps.set(app.manifest.id, app);
  }

  /**
   * 获取指定应用，不存在返回 undefined
   */
  get(id: string): AppPackageDefinition | undefined {
    return this.apps.get(id);
  }

  /**
   * 获取指定应用，不存在则兜底返回默认应用（analytics）
   */
  getOrDefault(id?: string | null): AppPackageDefinition {
    if (id && this.apps.has(id)) {
      return this.apps.get(id)!;
    }
    return this.apps.get(DEFAULT_APP_ID) ?? analyticsAppPackage;
  }

  /**
   * 列出所有已注册应用包
   */
  list(): AppPackageDefinition[] {
    return Array.from(this.apps.values());
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
