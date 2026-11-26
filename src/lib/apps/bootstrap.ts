import { appRegistry } from "./registry";
import { loadAppsConfigWithFallback } from "./appConfigServer";
import {
  AppPackageManager,
  type InstalledAppLoadFailure,
} from "./packageManager";
import { getGinkgoHomeDir } from "@/lib/storagePaths";

/**
 * 应用启动引导：让「已安装应用」在进程重启后仍然可用。
 *
 * 之前的缺口：安装时把条目写进 `config/apps.json`，但注册表只按打包内的
 * 内置字典注册，重启后动态安装的应用既不在内存也不可切换（isRegistered=false）。
 *
 * 幂等单飞：Next 开发模式热重载会多次触发 instrumentation，必须只跑一次；
 * 整体失败**不抛出**——应用生态损坏不应让宿主起不来。
 */
export interface AppsBootstrapReport {
  storageRoot: string;
  /** 已注册应用 id（含停用） */
  registeredAppIds: string[];
  /** 其中处于启用状态的 id */
  enabledAppIds: string[];
  failures: InstalledAppLoadFailure[];
  /** 配置损坏等可降级问题的提示（UI 可展示） */
  warning?: string;
}

let bootstrapPromise: Promise<AppsBootstrapReport> | null = null;
let lastReport: AppsBootstrapReport | null = null;

/** 读取引导报告（未引导或引导失败时返回 null） */
export function getAppsBootstrapReport(): AppsBootstrapReport | null {
  return lastReport;
}

/** 某个应用的载入失败原因（供 GET /api/apps 展示） */
export function getAppLoadFailure(id: string): string | undefined {
  return lastReport?.failures.find((f) => f.id === id)?.message;
}

async function runBootstrap(): Promise<AppsBootstrapReport> {
  const storageRoot = getGinkgoHomeDir();
  const { config, warning } = await loadAppsConfigWithFallback();

  // 1. 重置注册表并注册内置应用（幂等）
  appRegistry.initFromConfig(config);

  // 2. 载入配置声明的第三方应用（单个失败不阻断其余）
  const failures = await AppPackageManager.registerInstalledApps(config);

  const report: AppsBootstrapReport = {
    storageRoot,
    registeredAppIds: appRegistry.getRegisteredIds(),
    enabledAppIds: appRegistry.list().map((app) => app.manifest.id),
    failures,
    ...(warning ? { warning } : {}),
  };
  lastReport = report;

  if (warning) {
    console.warn(`[apps] 应用配置降级: ${warning}`);
  }
  console.log(
    `[apps] 已注册 ${report.registeredAppIds.length} 个应用` +
      `（启用 ${report.enabledAppIds.length} 个）` +
      (failures.length > 0 ? `，${failures.length} 个载入失败` : "")
  );
  for (const failure of failures) {
    console.warn(
      `[apps] 应用 [${failure.id}] 载入失败（${
        failure.packageName || "无 package"
      }）: ${failure.message}`
    );
  }

  return report;
}

/**
 * 执行（或复用）启动引导。
 *
 * 调用点：`src/instrumentation.ts`（服务端启动）。
 * 测试可调用 `resetAppsBootstrapForTesting()` 后重新引导。
 */
export function bootstrapApps(): Promise<AppsBootstrapReport> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch((err: unknown) => {
      console.error("[apps] 启动引导失败（已忽略，宿主继续启动）:", err);
      const report: AppsBootstrapReport = {
        storageRoot: getGinkgoHomeDir(),
        registeredAppIds: [],
        enabledAppIds: [],
        failures: [],
        warning: err instanceof Error ? err.message : String(err),
      };
      lastReport = report;
      return report;
    });
  }
  return bootstrapPromise;
}

/** 测试专用：清空单飞状态，允许重新引导 */
export function resetAppsBootstrapForTesting(): void {
  bootstrapPromise = null;
  lastReport = null;
}
