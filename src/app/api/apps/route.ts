import { NextResponse } from "next/server";
import { appRegistry } from "@/lib/apps/registry";
import { loadAppsConfigWithFallback } from "@/lib/apps/appConfigServer";
import {
  bootstrapApps,
  getAppLoadFailure,
  getAppsBootstrapReport,
} from "@/lib/apps/bootstrap";
import { checkAppHealth } from "@/lib/apps/capabilityNegotiator";
import type { AppHealthCheckResult } from "@ginkgolab/app-sdk";

/** 应用未注册且无明确失败原因时的兜底说明 */
const NOT_REGISTERED_HINT =
  "应用未注册：可能是包未安装、载入失败或未在启动引导中完成注册";

/**
 * 获取所有应用列表及其配置与健康状态
 * GET /api/apps
 *
 * 列表事实来源是**磁盘配置**（`config/apps.json`），注册表只提供「是否已注册 /
 * 是否启用 / 健康自检」这类运行时事实。两者不再各说各话。
 */
export async function GET() {
  // 幂等引导：instrumentation 已在启动期执行；测试/边缘启动路径在此兜底
  await bootstrapApps();

  const { config, warning } = await loadAppsConfigWithFallback();
  const report = getAppsBootstrapReport();

  const items = await Promise.all(
    config.apps.map(async (entry) => {
      const app = appRegistry.get(entry.id);
      const isRegistered = Boolean(app);
      const isEnabled = appRegistry.isAppEnabled(entry.id);

      let health: AppHealthCheckResult = {
        healthy: true,
        status: "ready",
        message: "就绪",
      };

      if (app) {
        health = await checkAppHealth(app);
      } else {
        health = {
          healthy: false,
          status: "missing_deps",
          message: NOT_REGISTERED_HINT,
        };
      }

      return {
        id: entry.id,
        name: app?.manifest.name || entry.name || entry.id,
        description: app?.manifest.description || "",
        icon: app?.manifest.icon || "Bot",
        category: app?.manifest.category,
        package: entry.package,
        enabled: isEnabled,
        builtin: entry.builtin ?? true,
        isRegistered,
        /** 载入失败原因（仅未注册时有值），供 UI 展示可操作信息 */
        loadError: isRegistered ? undefined : getAppLoadFailure(entry.id),
        health,
      };
    })
  );

  return NextResponse.json({
    apps: items,
    activeCount: appRegistry.list().length,
    ...(warning ? { warning } : {}),
    ...(report?.failures.length ? { loadFailures: report.failures } : {}),
  });
}
