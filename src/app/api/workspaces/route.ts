import { NextResponse } from "next/server";
import { workspaceStore } from "@/lib/workspaceStore";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const appId = searchParams.get("appId") ?? undefined;
  const list = await workspaceStore.list(appId);
  return NextResponse.json({ workspaces: list });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name) {
      return NextResponse.json({ error: "工作区名称不能为空" }, { status: 400 });
    }
    const ws = await workspaceStore.create({
      name: body.name,
      path: body.path,
      appId: body.appId || "general",
    });
    return NextResponse.json({ workspace: ws });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "创建工作区失败" },
      { status: 500 }
    );
  }
}
