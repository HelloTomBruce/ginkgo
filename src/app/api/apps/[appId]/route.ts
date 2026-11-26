import { NextResponse } from "next/server";
import { AppPackageManager } from "@/lib/apps/packageManager";

/**
 * 卸载应用
 * DELETE /api/apps/[appId]
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await context.params;
    const result = await AppPackageManager.uninstallPackage(appId);
    if (!result.success) {
      // 状态码由领域层给出（内置拒绝卸载 400 / 不存在 404 / 其它 500），路由不猜语义
      return NextResponse.json(
        { error: result.message || "Failed to uninstall package" },
        { status: result.status ?? 500 }
      );
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
