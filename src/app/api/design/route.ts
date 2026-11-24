import { NextResponse } from "next/server";
import { DesignService } from "@ginkgo-apps/design/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspacePath = searchParams.get("workspacePath");

    if (!workspacePath) {
      return NextResponse.json({ error: "Missing workspacePath" }, { status: 400 });
    }

    const status = await DesignService.getStatus(workspacePath);
    return NextResponse.json(status);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "serve" | "stop" | "audit";
      workspacePath?: string;
      targetDir?: string;
    };

    const { action, workspacePath, targetDir } = body;
    if (!action || !workspacePath) {
      return NextResponse.json({ error: "Missing action or workspacePath" }, { status: 400 });
    }

    if (action === "serve") {
      const res = await DesignService.serve(workspacePath);
      return NextResponse.json(res);
    }

    if (action === "stop") {
      const res = await DesignService.stop(workspacePath);
      return NextResponse.json(res);
    }

    if (action === "audit") {
      const res = await DesignService.audit(targetDir || workspacePath);
      return NextResponse.json(res);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
