import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppPermission, AppPackageDefinition } from "@ginkgolab/app-sdk";
import { diffUnacknowledgedPermissions } from "@ginkgolab/app-sdk";
import { getPluginsDir, getConfigDir, getStoragePath } from "@/lib/storagePaths";
import { appRegistry, BUILTIN_APP_PACKAGES } from "./registry";
import type { AppConfigFile } from "./registry";
import { loadAppsConfig, mutateAppsConfig } from "./appConfigServer";
import {
  ensurePluginsDir,
  readPluginDependencies,
  resolveInstalledPackage,
  validatePackageSpec,
} from "./appSpec";

const execFileAsync = promisify(execFile);

export interface InstallResult {
  success: boolean;
  appId?: string;
  name?: string;
  message?: string;
  /** 失败码：供路由映射状态码（permissions_required → 409） */
  code?: "invalid_spec" | "permissions_required" | "install_failed";
  /** 需要用户确认的权限（仅 code=permissions_required 时有值） */
  requiredPermissions?: AppPermission[];
}

/** 已安装应用的载入失败记录（供 GET /api/apps 展示，不阻断启动） */
export interface InstalledAppLoadFailure {
  id: string;
  packageName: string;
  message: string;
}

// ========== 进程内安装互斥：避免并发 npm install 竞争同一 plugins 目录 ==========

let installChain: Promise<unknown> = Promise.resolve();

function withInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = installChain.then(fn, fn);
  installChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * 把第三方应用在 `manifest.lifecycle.onHealthCheck` 里声明的探测，
 * 适配到 `server.healthCheck`——运行时只有一条调用路径（见 capabilityNegotiator）。
 */
function adaptLifecycleHealthCheck(
  pkg: AppPackageDefinition
): AppPackageDefinition {
  const legacy = pkg.manifest.lifecycle?.onHealthCheck;
  if (!legacy || pkg.server.healthCheck) return pkg;
  return {
    ...pkg,
    server: { ...pkg.server, healthCheck: (ctx) => legacy(ctx) },
  };
}

export class AppPackageManager {
  /** 确保插件安装目录存在且包含初始 package.json */
  static async ensurePluginsDir(): Promise<string> {
    return ensurePluginsDir();
  }

  /** 解析并载入已安装的应用包（薄委托，见 appSpec 的通道说明） */
  static async resolveInstalledPackage(
    packageName: string
  ): Promise<AppPackageDefinition> {
    return resolveInstalledPackage(packageName);
  }

  /**
   * 启动引导：把配置中非内置、且声明了 package 的条目载入注册表。
   *
   * 失败**不抛出**——单个应用包损坏/依赖缺失不应让宿主起不来；失败项汇总后由
   * `GET /api/apps` 展示为「未注册 + 原因」。
   */
  static async registerInstalledApps(
    config: AppConfigFile
  ): Promise<InstalledAppLoadFailure[]> {
    const failures: InstalledAppLoadFailure[] = [];
    const entries = Array.isArray(config?.apps) ? config.apps : [];

    for (const entry of entries) {
      if (!entry?.id) continue;
      if (entry.builtin) continue; // 内置应用已由 initFromConfig 注册
      if (!entry.package) {
        failures.push({
          id: entry.id,
          packageName: "",
          message: "配置缺少 package 字段，无法载入",
        });
        continue;
      }
      if (BUILTIN_APP_PACKAGES[entry.id]) {
        // 防「第三方包冒用内置 id」：配置声明的 id 已有内置实现时不覆盖
        failures.push({
          id: entry.id,
          packageName: entry.package,
          message: "该 id 已被内置应用占用，拒绝覆盖",
        });
        continue;
      }

      try {
        const pkg = await this.resolveInstalledPackage(entry.package);
        if (!pkg?.manifest?.id) {
          throw new Error("模块未导出合法的 manifest.id");
        }
        if (pkg.manifest.id !== entry.id) {
          throw new Error(
            `manifest.id (${pkg.manifest.id}) 与配置 id (${entry.id}) 不一致`
          );
        }
        appRegistry.register(adaptLifecycleHealthCheck(pkg), {
          enabled: entry.enabled !== false,
        });
      } catch (err: unknown) {
        failures.push({
          id: entry.id,
          packageName: entry.package,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return failures;
  }

  /**
   * 动态安装应用包。
   *
   * 安全约束（详见 docs/app-store-remediation-plan.md D4）：
   *   - spec 白名单校验（appSpec.validatePackageSpec），拒绝路径穿越与裸包名；
   *   - 内置 id 不可被覆盖；
   *   - 声明了 `permissions` 的包必须由调用方确认权限后才注册（两段握手，
   *     未确认时返回 code=permissions_required，包已落地但**不注册/不启用**）；
   *   - 进程内互斥，避免并发写同一 plugins 目录。
   */
  static async installPackage(
    packageSpec: string,
    options?: {
      enableImmediately?: boolean;
      mockPackage?: AppPackageDefinition;
      acknowledgedPermissions?: readonly string[];
    }
  ): Promise<InstallResult> {
    const validation = validatePackageSpec(packageSpec);
    if (!validation.ok) {
      return {
        success: false,
        code: "invalid_spec",
        message: `非法的应用包标识：${validation.reason}`,
      };
    }
    const spec = validation.value;

    return withInstallLock(async () => {
      const pluginsDir = await this.ensurePluginsDir();
      const configDir = getConfigDir();
      const workspaceDir = getStoragePath("data", "workspaces");

      let loadedApp: AppPackageDefinition | undefined = options?.mockPackage;
      let packageName = spec.packageName ?? "";

      if (!loadedApp) {
        // tarball 安装前包名未知：记录安装前依赖集合，安装后 diff 出新增项
        const depsBefore = await readPluginDependencies();

        try {
          await execFileAsync("npm", ["install", spec.spec, "--save"], {
            cwd: pluginsDir,
            timeout: 120_000,
          });
        } catch (err: unknown) {
          return {
            success: false,
            code: "install_failed" as const,
            message: `npm 安装失败: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (!packageName) {
          const depsAfter = await readPluginDependencies();
          const added = Object.keys(depsAfter).filter((k) => !(k in depsBefore));
          if (added.length !== 1) {
            return {
              success: false,
              code: "install_failed" as const,
              message:
                added.length === 0
                  ? "安装完成但未识别到新增依赖，无法确定包名"
                  : `安装完成但新增了多个依赖（${added.join(", ")}），请改用显式包名安装`,
            };
          }
          packageName = added[0];
        }

        try {
          loadedApp = await this.resolveInstalledPackage(packageName);
        } catch (err: unknown) {
          return {
            success: false,
            code: "install_failed" as const,
            message: `应用包载入失败: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      if (!loadedApp?.manifest?.id) {
        return {
          success: false,
          code: "install_failed",
          message: "非法的 Ginkgo 应用包：未找到有效的 manifest.id",
        };
      }

      const appId = loadedApp.manifest.id;

      // 内置应用不可被动态覆盖（防「装 A 冒名 B」覆盖平台自带能力）
      if (BUILTIN_APP_PACKAGES[appId]) {
        return {
          success: false,
          appId,
          code: "install_failed",
          message: `应用 id [${appId}] 属于平台内置应用，不允许被动态包覆盖`,
        };
      }

      // 包名与 manifest.id 交叉校验（tarball/改名包防冒名）
      if (packageName && loadedApp.manifest.package && loadedApp.manifest.package !== packageName) {
        return {
          success: false,
          appId,
          code: "install_failed",
          message: `manifest.package (${loadedApp.manifest.package}) 与实际安装包 (${packageName}) 不一致`,
        };
      }

      // 权限握手：声明了 permissions 且未确认 → 不注册、不启用
      const unacknowledged = diffUnacknowledgedPermissions(
        loadedApp.manifest.permissions,
        options?.acknowledgedPermissions
      );
      if (unacknowledged.length > 0) {
        return {
          success: false,
          appId,
          name: loadedApp.manifest.name,
          code: "permissions_required",
          requiredPermissions: unacknowledged,
          message: `应用 [${loadedApp.manifest.name}] 申请了 ${unacknowledged.length} 项权限，需确认后才会启用`,
        };
      }

      // 执行应用自定义的 onInstall 生命周期钩子（在权限确认之后）
      if (typeof loadedApp.manifest.lifecycle?.onInstall === "function") {
        try {
          const installVerdict = await loadedApp.manifest.lifecycle.onInstall({
            workspaceDir,
            configDir,
            pluginsDir,
          });
          if (installVerdict && installVerdict.success === false) {
            return {
              success: false,
              appId,
              code: "install_failed",
              message: `应用 onInstall 初始化未通过: ${installVerdict.message || ""}`,
            };
          }
        } catch (err: unknown) {
          return {
            success: false,
            appId,
            code: "install_failed",
            message: `应用 onInstall 执行异常: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      const isEnabled = options?.enableImmediately !== false;
      appRegistry.register(loadedApp, { enabled: isEnabled });

      await mutateAppsConfig((config) => {
        const existingIndex = config.apps.findIndex((a) => a.id === appId);
        const newEntry = {
          id: appId,
          name: loadedApp?.manifest.name,
          package: packageName || spec.spec,
          enabled: isEnabled,
          builtin: false,
          // 留痕：确认过的权限集合（审计用）
          ...(loadedApp?.manifest.permissions
            ? { permissions: [...loadedApp.manifest.permissions] }
            : {}),
        };

        if (existingIndex >= 0) {
          config.apps[existingIndex] = newEntry;
        } else {
          config.apps.push(newEntry);
        }
      });

      return {
        success: true,
        appId,
        name: loadedApp.manifest.name,
        message: `应用 [${loadedApp.manifest.name}] 安装成功并已激活`,
      };
    });
  }

  /**
   * 卸载已安装应用：钩子 → npm uninstall → 注销 → 配置移除。
   *
   * 「卸载」必须真的把包从 plugins 目录摘掉，否则磁盘上的第三方代码会一直
   * 留在进程可 import 的路径上。
   */
  static async uninstallPackage(
    appId: string
  ): Promise<{ success: boolean; message?: string; status?: number }> {
    const app = appRegistry.get(appId);
    const pluginsDir = await this.ensurePluginsDir();
    const configDir = getConfigDir();
    const workspaceDir = getStoragePath("data", "workspaces");

    if (BUILTIN_APP_PACKAGES[appId]) {
      return {
        success: false,
        status: 400,
        message: `应用 [${appId}] 属于平台内置应用，不支持卸载（可改为停用）`,
      };
    }

    const config = await loadAppsConfig();
    const entry = config.apps.find((item) => item.id === appId);
    if (!app && !entry) {
      return { success: false, status: 404, message: `应用 [${appId}] 不存在` };
    }

    // 触发 onUninstall 生命周期钩子（失败不阻断卸载，但要留痕）
    if (app && typeof app.manifest.lifecycle?.onUninstall === "function") {
      try {
        await app.manifest.lifecycle.onUninstall({
          workspaceDir,
          configDir,
          pluginsDir,
        });
      } catch (err: unknown) {
        console.warn(`[packageManager] 应用 ${appId} onUninstall 钩子执行报错:`, err);
      }
    }

    // 真正摘掉磁盘上的包（仅对能从配置反查到包名的安装有效）
    const packageName = entry?.package;
    if (packageName && !packageName.startsWith("file:")) {
      try {
        await execFileAsync("npm", ["uninstall", packageName], {
          cwd: pluginsDir,
          timeout: 120_000,
        });
      } catch (err: unknown) {
        // 包本就不在磁盘上时 npm 会报错；不因此阻断配置清理，但要告知
        console.warn(
          `[packageManager] npm uninstall ${packageName} 未成功（继续清理注册表）:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // 从注册表**注销**（不是仅停用：仅停用会让动作网关仍可通过 has() 守卫）
    appRegistry.unregister(appId);

    await mutateAppsConfig((cfg) => {
      cfg.apps = cfg.apps.filter((item) => item.id !== appId);
    });

    return { success: true, message: `应用 [${appId}] 已成功卸载` };
  }

  /** 启停应用 */
  static async toggleApp(
    appId: string,
    enabled: boolean
  ): Promise<{ success: boolean; message?: string; status?: number }> {
    // 先落盘再改内存：落盘失败不应造成「界面显示停用、运行时仍启用」
    try {
      await mutateAppsConfig((config) => {
        const target = config.apps.find((a) => a.id === appId);
        if (!target) {
          throw new Error(`应用 [${appId}] 不在配置清单中`);
        }
        target.enabled = enabled;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        status: message.includes("不在配置清单") ? 404 : 500,
        message,
      };
    }

    const ok = appRegistry.setEnabled(appId, enabled);
    if (!ok) {
      return {
        success: false,
        status: 404,
        message: `应用 [${appId}] 未注册，无法切换启用态`,
      };
    }
    return { success: true };
  }
}

/** 供诊断：读取原始配置（损坏时抛出，调用方决定降级策略） */
export async function readRawAppsConfig(): Promise<AppConfigFile> {
  return loadAppsConfig();
}

/** 供诊断：插件目录绝对路径 */
export function describePluginsDir(): string {
  return path.resolve(getPluginsDir());
}
