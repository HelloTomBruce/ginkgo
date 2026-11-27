import {
  PLATFORM_PROVIDED_CAPABILITIES,
  type AppHealthCheckContext,
  type AppHealthCheckResult,
  type AppPackageDefinition,
} from "@ginkgolab/app-sdk";
import { getConfigDir } from "@/lib/storagePaths";
import { resolveRuntimeServer } from "./runtimeServers";

/**
 * 应用能力协商与健康自检调度。
 *
 * **宿主零领域语义**是本模块的设计红线：
 *   - 平台自己提供的能力（`PLATFORM_PROVIDED_CAPABILITIES`）由宿主判定；
 *   - 其余能力（外部 CLI/服务）宿主**不做任何猜测**——不持有「能力 → 命令」
 *     映射表，也不内置修复指引，一律委托应用声明的 `server.healthCheck`。
 *
 * 历史实现曾在宿主里写死「设计类 / 禅道类 CLI 能力 → 可执行命令」的映射与
 * 中文修复文案，属于把应用领域知识塞进平台层（见实施文档 §1.2 R4）。
 * 本文件因此保持零外部命令引用——CI 守卫会 grep 该目录下的领域关键词。
 */

/** 健康检查结果缓存时长：避免每次 GET /api/apps 都重新探测外部命令 */
const HEALTH_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  result: AppHealthCheckResult;
}

const cache = new Map<string, CacheEntry>();

/** 测试专用：清空健康检查缓存 */
export function clearHealthCheckCache(): void {
  cache.clear();
}

const platformCapabilities = new Set<string>(PLATFORM_PROVIDED_CAPABILITIES);

/**
 * 对单个应用执行健康检查。
 *
 * 优先级：
 *   1. 应用声明了 `server.healthCheck` → 以它为准（应用知道自己缺什么）；
 *   2. 否则宿主只判定平台能力；声明了平台**不提供**的能力则降级并给出可操作提示
 *      （提示的是「请应用实现健康检查」，而不是宿主编造的安装命令）。
 */
export async function checkAppHealth(
  app: AppPackageDefinition
): Promise<AppHealthCheckResult> {
  const appId = app.manifest.id;

  const cached = cache.get(appId);
  if (cached && Date.now() - cached.at < HEALTH_CACHE_TTL_MS) {
    return cached.result;
  }

  const result = await computeHealth(app);
  cache.set(appId, { at: Date.now(), result });
  return result;
}

async function computeHealth(
  app: AppPackageDefinition
): Promise<AppHealthCheckResult> {
  const appId = app.manifest.id;

  // 1. 应用自治探测优先（运行时装配的健康检查实现更完整，优先于静态契约）
  const healthCheck =
    resolveRuntimeServer(appId)?.healthCheck ?? app.server.healthCheck;
  if (typeof healthCheck === "function") {
    const ctx: AppHealthCheckContext = {
      configDir: getConfigDir(),
      env: process.env,
    };
    try {
      return await healthCheck(ctx);
    } catch (err: unknown) {
      return {
        healthy: false,
        status: "degraded",
        message: `健康检查执行异常: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 2. 无应用探测：宿主只判平台能力
  const required = app.server.requiredCapabilities ?? [];
  const nonPlatform = required.filter((cap) => !platformCapabilities.has(cap));

  if (nonPlatform.length > 0) {
    return {
      healthy: false,
      status: "degraded",
      missingCapabilities: nonPlatform.map((cap) => `unverified:${cap}`),
      remediationGuide:
        "该应用声明了平台未内置提供的能力，但未实现 server.healthCheck —— " +
        "请在应用的服务端入口实现健康检查，返回缺失项与修复指引",
      message: `应用 [${appId}] 的外部依赖无法由平台判定（${nonPlatform.join(
        ", "
      )}）`,
    };
  }

  return {
    healthy: true,
    status: "ready",
    message: "平台能力已就绪",
  };
}
