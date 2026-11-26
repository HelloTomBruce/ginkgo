import { NextResponse } from "next/server";
import { AppPackageManager } from "@/lib/apps/packageManager";
import { validatePackageSpec } from "@/lib/apps/appSpec";
import type { AppPermission } from "@ginkgo/app-sdk";

/**
 * 动态安装应用包（高危：`npm install` + 模块求值 = 任意代码执行）。
 *
 * 三重闸门（缺一不可，对应 docs/app-store-remediation-plan.md D4）：
 *   1. `GINKGO_ALLOW_APP_INSTALL=1` 显式开启，默认关闭；
 *   2. 配置了 `GINKGO_APP_INSTALL_TOKEN` 时必须匹配 `x-ginkgo-install-token`；
 *   3. spec 白名单校验（appSpec.validatePackageSpec）。
 *
 * 为什么单独一道闸：全局 `GINKGO_API_AUTH_TOKEN` 默认不配置（本地单机形态），
 * 而安装的爆炸半径（主机被接管）远高于其它 `/api` 写入，不能共用同一把默认闸门。
 */
const INSTALL_DISABLED_MESSAGE =
  "应用安装功能未开启。这是高危能力（会执行安装包中的代码）：如需启用，请设置环境变量 GINKGO_ALLOW_APP_INSTALL=1，" +
  "并建议同时设置 GINKGO_APP_INSTALL_TOKEN 作为该接口的独立令牌。";

function checkInstallToken(
  req: Request
): { ok: true; tokenUnset: boolean } | { ok: false } {
  const expected = process.env.GINKGO_APP_INSTALL_TOKEN?.trim();
  if (!expected) return { ok: true, tokenUnset: true };
  const provided = req.headers.get("x-ginkgo-install-token");
  return provided === expected ? { ok: true, tokenUnset: false } : { ok: false };
}

interface InstallBody {
  packageSpec?: unknown;
  enableImmediately?: unknown;
  /** 用户已确认的权限清单（两段握手第二步） */
  acknowledgedPermissions?: unknown;
}

export async function POST(req: Request) {
  // 1. 能力开关
  if (process.env.GINKGO_ALLOW_APP_INSTALL !== "1") {
    return NextResponse.json({ error: INSTALL_DISABLED_MESSAGE }, { status: 403 });
  }

  // 2. 独立令牌
  const tokenCheck = checkInstallToken(req);
  if (!tokenCheck.ok) {
    return NextResponse.json(
      { error: "安装令牌无效（x-ginkgo-install-token 与 GINKGO_APP_INSTALL_TOKEN 不匹配）" },
      { status: 401 }
    );
  }
  if (tokenCheck.tokenUnset) {
    console.warn(
      "[apps] 安装功能已开启但未配置 GINKGO_APP_INSTALL_TOKEN：共享/公网环境请务必配置该令牌"
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as InstallBody;

    // 3. spec 校验（与 packageManager 内的校验同源，这里提前给出 400）
    const validation = validatePackageSpec(body.packageSpec);
    if (!validation.ok) {
      return NextResponse.json(
        { error: `非法的应用包标识：${validation.reason}` },
        { status: 400 }
      );
    }

    const acknowledged = Array.isArray(body.acknowledgedPermissions)
      ? body.acknowledgedPermissions.filter(
          (item): item is string => typeof item === "string"
        )
      : undefined;

    const result = await AppPackageManager.installPackage(
      (body.packageSpec as string).trim(),
      {
        enableImmediately: body.enableImmediately !== false,
        ...(acknowledged ? { acknowledgedPermissions: acknowledged } : {}),
      }
    );

    if (result.success) {
      return NextResponse.json(result);
    }

    // 权限握手第一步：409 + 权限清单，前端确认后带 acknowledgedPermissions 重试
    if (result.code === "permissions_required") {
      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          appId: result.appId,
          name: result.name,
          requiredPermissions: result.requiredPermissions satisfies
            | AppPermission[]
            | undefined,
          hint: "包已下载但未启用：确认权限后带上 acknowledgedPermissions 重新提交即可启用",
        },
        { status: 409 }
      );
    }

    const status = result.code === "invalid_spec" ? 400 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
