import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AppPackageDefinition } from "@ginkgo/app-sdk";
import { getPluginsDir } from "@/lib/storagePaths";

/**
 * 应用包 spec 的校验与模块解析（单一实现）。
 *
 * 这是安装链路的**信任边界**：`packageSpec` 直接来自 HTTP 请求体，最终会喂给
 * `npm install` 并被 `import()` 执行。因此校验必须白名单化（只接受
 * `@scope/name[@semver]` 与显式开启时的本地 tarball），而不是黑名单过滤。
 */

/** npm 包名长度上限（与 npm 规范一致） */
const MAX_SPEC_LENGTH = 214;

const SCOPED_NPM_SPEC =
  /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)(?:@([~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/;

/** 允许被当作包名的最小形态（`.tgz` 安装后需从 package.json 反查） */
export type PackageSpecKind = "npm" | "tarball";

export interface ValidPackageSpec {
  kind: PackageSpecKind;
  /** 原样传给 npm install 的 spec */
  spec: string;
  /** npm 包名；tarball 形态安装前未知，为 null */
  packageName: string | null;
}

export type PackageSpecValidation =
  | { ok: true; value: ValidPackageSpec }
  | { ok: false; reason: string };

/**
 * 校验安装 spec。
 *
 * 拒绝清单（返回原因，不抛错）：
 *   - 空 / 超长；
 *   - 含 `..`（路径穿越）、空白、shell 元字符；
 *   - 非 `@scope/name[@semver]` 形态的裸包名（避免把 `lodash` 之类的
 *     非 Ginkgo 包装进插件区）；
 *   - 本地 tarball 未显式开启（`GINKGO_ALLOW_LOCAL_APP_PACKAGE=1`）。
 */
export function validatePackageSpec(
  raw: unknown,
  env: Record<string, string | undefined> = process.env
): PackageSpecValidation {
  if (typeof raw !== "string") {
    return { ok: false, reason: "packageSpec 必须是字符串" };
  }
  const spec = raw.trim();
  if (!spec) {
    return { ok: false, reason: "packageSpec 不能为空" };
  }
  if (spec.length > MAX_SPEC_LENGTH) {
    return { ok: false, reason: `packageSpec 超过 ${MAX_SPEC_LENGTH} 字符上限` };
  }
  if (spec.includes("..")) {
    return { ok: false, reason: "packageSpec 不允许包含 '..'（路径穿越）" };
  }
  // 白名单正则本身已排除 shell 元字符；此处显式拦截空白以给出更明确的提示
  if (/\s/.test(spec)) {
    return { ok: false, reason: "packageSpec 不允许包含空白字符" };
  }

  const npmMatch = SCOPED_NPM_SPEC.exec(spec);
  if (npmMatch) {
    return {
      ok: true,
      value: { kind: "npm", spec, packageName: npmMatch[1] },
    };
  }

  const isLocalTarball =
    (spec.startsWith("file:") || spec.startsWith("/")) &&
    (spec.endsWith(".tgz") || spec.endsWith(".tar.gz"));
  if (isLocalTarball) {
    if (env.GINKGO_ALLOW_LOCAL_APP_PACKAGE !== "1") {
      return {
        ok: false,
        reason:
          "本地包安装默认关闭：如需从本地 tarball 安装，请设置 GINKGO_ALLOW_LOCAL_APP_PACKAGE=1",
      };
    }
    return { ok: true, value: { kind: "tarball", spec, packageName: null } };
  }

  return {
    ok: false,
    reason:
      "packageSpec 形态非法：仅接受 @scope/name 或 @scope/name@1.2.3（本地 tarball 需显式开启）",
  };
}

// ========== 模块解析与加载 ==========

type LoadedModule = ({ default?: AppPackageDefinition } &
  Partial<AppPackageDefinition>) | undefined;

/**
 * 确保插件目录存在（createRequire 需要其 package.json 作为解析锚点）。
 */
export async function ensurePluginsDir(): Promise<string> {
  const pluginsDir = getPluginsDir();
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgJsonPath = path.join(pluginsDir, "package.json");
  try {
    await fs.access(pkgJsonPath);
  } catch {
    await fs.writeFile(
      pkgJsonPath,
      JSON.stringify(
        {
          name: "ginkgo-plugins",
          description: "Ginkgo dynamic installed plugins and apps",
          private: true,
          dependencies: {},
        },
        null,
        2
      ),
      "utf-8"
    );
  }
  return pluginsDir;
}

/**
 * 从绝对路径加载第三方应用模块。
 *
 * 两条通道都必须保留，缺一不可：
 *   1. `require`（经 createRequire）：在 vitest 的 vm 沙箱里也能工作，且
 *      Node ≥ 22.12 支持 `require(esm)`；
 *   2. 原生 `import()`（经 Function 构造绕开打包器）：Next 的 Turbopack 会把
 *      `import(变量)` 改写成内置 loader，对任意绝对路径报
 *      "Cannot find module as expression is too dynamic"；而 Function 形式
 *      在 vm 沙箱里会报 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING。
 */
async function loadModuleFromFile(
  entryPath: string,
  packageName: string
): Promise<LoadedModule> {
  let requireError: unknown;
  try {
    const localRequire = createRequire(entryPath);
    return localRequire(entryPath) as LoadedModule;
  } catch (err) {
    requireError = err;
  }

  try {
    const nativeImport = new Function(
      "specifier",
      "return import(specifier)"
    ) as (specifier: string) => Promise<LoadedModule>;
    return await nativeImport(pathToFileURL(entryPath).href);
  } catch (importError) {
    const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));
    throw new Error(
      `包 "${packageName}" 载入失败（require: ${detail(requireError)}；import: ${detail(importError)}）`
    );
  }
}

/**
 * 解析并载入已安装的应用包。
 *
 * 用 `createRequire` 交给 Node 做包解析，而不是 `path.join(node_modules, spec)`：
 * 后者对 `@scope/name@1.2.3` 会拼出不存在的路径（版本号进目录名），
 * 且 `..` 可逃逸出插件目录后被 `import()` 执行。
 */
export async function resolveInstalledPackage(
  packageName: string
): Promise<AppPackageDefinition> {
  const pluginsDir = await ensurePluginsDir();
  const requireFromPlugins = createRequire(
    path.join(pluginsDir, "package.json")
  );

  let entryPath: string;
  try {
    entryPath = requireFromPlugins.resolve(packageName);
  } catch (err: unknown) {
    throw new Error(
      `无法在插件目录解析包 "${packageName}": ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const imported = await loadModuleFromFile(entryPath, packageName);
  if (!imported) {
    throw new Error(`包 "${packageName}" 未导出任何内容`);
  }
  return (imported.default ?? imported) as AppPackageDefinition;
}

/** 读取插件目录已声明的依赖（用于 tarball 安装后反查包名、以及安装前后 diff） */
export async function readPluginDependencies(): Promise<Record<string, string>> {
  const pluginsDir = await ensurePluginsDir();
  try {
    const raw = await fs.readFile(path.join(pluginsDir, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return parsed.dependencies ?? {};
  } catch {
    return {};
  }
}
