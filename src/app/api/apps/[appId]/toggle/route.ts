import { NextResponse } from "next/server";
import { AppPackageManager } from "@/lib/apps/packageManager";

/**
 * 切换应用的启用/停用状态
 * POST /api/apps/[appId]/toggle
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "Invalid enabled state (boolean required)" },
        { status: 400 }
      );
    }

    const result = await AppPackageManager.toggleApp(appId, enabled);
    if (!result.success) {
      return NextResponse.json(
        { error: result.message || `App not found: ${appId}` },
        { status: result.status ?? 500 }
      );
    }

    return NextResponse.json({ success: true, appId, enabled });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
