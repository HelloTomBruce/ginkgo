import { NextResponse } from "next/server";
import {
  loadMcpServers,
  saveMcpServers,
  getMcpManager,
  type StoredMcpServer,
} from "@/lib/mcpStore";

export async function GET() {
  const servers = await loadMcpServers();
  const manager = getMcpManager();

  const statuses = servers.map((s) => {
    const status = manager.getStatus(s.id);
    return {
      ...s,
      status: status || {
        serverId: s.id,
        connected: false,
        transport: s.transport,
        toolCount: 0,
      },
    };
  });

  return NextResponse.json({ servers: statuses });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StoredMcpServer;
    if (!body || !body.id || !body.transport) {
      return NextResponse.json(
        { error: "MCP Server 配置必须包含 id 与 transport" },
        { status: 400 }
      );
    }

    const servers = await loadMcpServers();
    const existingIndex = servers.findIndex((s) => s.id === body.id);
    let next: StoredMcpServer[];

    if (existingIndex >= 0) {
      next = [...servers];
      next[existingIndex] = {
        ...body,
        enabled: body.enabled !== false,
      };
    } else {
      next = [
        ...servers,
        {
          ...body,
          enabled: body.enabled !== false,
        },
      ];
    }

    await saveMcpServers(next);
    return NextResponse.json({ success: true, server: body });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存 MCP Server 失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "缺少要删除的 MCP Server id" },
        { status: 400 }
      );
    }

    const servers = await loadMcpServers();
    const next = servers.filter((s) => s.id !== id);
    await saveMcpServers(next);

    return NextResponse.json({ success: true, deleted: id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除 MCP Server 失败" },
      { status: 500 }
    );
  }
}
