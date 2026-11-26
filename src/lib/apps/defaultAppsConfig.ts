import type { AppConfigFile } from "./registry";

/**
 * 内置应用的初始配置（**代码里的种子，不是运行期配置**）。
 *
 * 为什么不能 import `config/apps.json`：`config/` 被 gitignore（内含用户本地的
 * 数据源、MCP 密钥等），全新克隆里不存在——把它当模块 import 会让 `pnpm typecheck`
 * 在 CI 上直接失败（真实发生过：`Cannot find module '../../../config/apps.json'`）。
 *
 * 事实来源约定不变：
 *   - 运行期以 `<存储根>/config/apps.json` 为准（`appConfigServer.loadAppsConfig`）；
 *   - 该文件不存在（首次运行）时用本种子初始化；
 *   - 本种子同时提供客户端首屏的同步兜底（registry 单例构造）。
 */
export const DEFAULT_APPS_CONFIG: AppConfigFile = {
  apps: [
    {
      id: "analytics",
      name: "智能数据分析",
      package: "@ginkgo-apps/analytics",
      enabled: true,
      builtin: true,
    },
    {
      id: "general",
      name: "通用智能助手",
      package: "@ginkgo-apps/general",
      enabled: true,
      builtin: true,
    },
    {
      id: "design",
      name: "体验设计工坊",
      package: "@ginkgo-apps/design",
      enabled: true,
      builtin: true,
    },
  ],
};

/** 取一份可变副本：调用方（配置读改写）会就地修改，不能污染模块级种子 */
export function cloneDefaultAppsConfig(): AppConfigFile {
  return structuredClone(DEFAULT_APPS_CONFIG);
}
