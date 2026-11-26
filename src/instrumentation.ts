/**
 * 服务端启动引导（Next.js instrumentation）。
 *
 * 两件事必须发生在「首个请求之前」：
 *   1. 解析并下发统一存储根（`GINKGO_RESOLVED_HOME`）。能力包与应用包禁止
 *      import 宿主模块，它们的模块级单例经该变量读取存储根；晚解析会让先被判定的
 *      包回退到 cwd，形成分裂存储。
 *   2. 按 `config/apps.json` 注册应用（内置 + 已安装的第三方）。否则动态安装的
 *      应用重启后不在注册表里——安装等于一次性有效。
 *
 * 两者都用动态 import 延迟加载，避免把应用包依赖图拖进 instrumentation 自身的编译单元。
 */
export async function register(): Promise<void> {
  // edge runtime 无 node:fs；存储根与应用引导只在 nodejs runtime 有意义
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getGinkgoHomeDir, hasLegacyLocalStorage } = await import(
    "@/lib/storagePaths"
  );

  const home = getGinkgoHomeDir();
  console.log(`[storage] 数据根: ${home}`);

  // 显式外移 + 本地仍有历史数据：只提示，不自动搬家（搬错数据的代价高于搬家收益）
  const explicit =
    process.env.GINKGO_HOME?.trim() || process.env.GINKGO_DATA_DIR?.trim();
  if (explicit && hasLegacyLocalStorage()) {
    console.warn(
      "[storage] 检测到本地 ./data 或 ./config 与显式配置的存储根并存。" +
        "平台不会自动迁移；如需合并请执行 `pnpm storage:migrate`（先复制、校验后再手动删除源目录）。"
    );
  }

  try {
    const { bootstrapApps } = await import("@/lib/apps/bootstrap");
    await bootstrapApps();
  } catch (err) {
    // 应用生态损坏不应让宿主起不来
    console.error("[apps] 启动引导异常（已忽略）:", err);
  }
}
