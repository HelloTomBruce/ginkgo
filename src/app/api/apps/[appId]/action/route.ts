import { NextResponse } from "next/server";
import { appRegistry } from "@/lib/apps/registry";
import { resolveRuntimeServer } from "@/lib/apps/runtimeServers";
import { sessionStore } from "@/lib/sessionStore";
import { resolveWorkspaceForSession } from "@/lib/workspaceResolver";

interface ActionRequestBody {
  action?: string;
  payload?: Record<string, unknown>;
  sessionId?: string;
}

/**
 * 通用应用动作分发网关 (App Action Gateway)
 * POST /api/apps/[appId]/action
 *
 * 核心职责（零应用领域语义）：
 * 1. 白名单合法性拦截；
 * 2. 会话身份与应用归属权校验（防跨会话越权）；
 * 3. 统一沙箱物理上下文安全归一化（防 Path Traversal）；
 * 4. 委托组合根对应应用实现类的 dispatchAction 执行并回包。
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await context.params;

    // 1. 白名单合法性守卫 (Strict AppId Allowlist)
    if (!appRegistry.has(appId)) {
      return NextResponse.json(
        { error: `App not found: ${appId}` },
        { status: 404 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ActionRequestBody;
    const { action, payload = {}, sessionId } = body;

    // 2. 基础参数与会话归属权校验 (Ownership Guard)
    if (!action || typeof action !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid action name" },
        { status: 400 }
      );
    }

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Missing sessionId" },
        { status: 400 }
      );
    }

    // 3. 校验会话所有权，严禁跨会话越权分发
    const session = await sessionStore.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: `Session not found: ${sessionId}` },
        { status: 404 }
      );
    }

    if (session.appId && session.appId !== appId) {
      return NextResponse.json(
        { error: `Session appId mismatch: expected ${session.appId}, got ${appId}` },
        { status: 403 }
      );
    }

    // 4. 解析受信工作区沙箱物理路径 (Platform Verified Workspace)
    const wsCtx = await resolveWorkspaceForSession(appId, sessionId);

    // 5. 组合根运行时契约解析
    const runtimeServer = resolveRuntimeServer(appId);
    if (!runtimeServer?.dispatchAction) {
      return NextResponse.json(
        { error: `App [${appId}] does not support dispatchAction` },
        { status: 501 }
      );
    }

    // 6. 委托执行
    const result = await runtimeServer.dispatchAction(action, payload, {
      appId,
      sessionId,
      workspaceDir: wsCtx.sandboxDir,
    });

    return NextResponse.json(result ?? { success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
