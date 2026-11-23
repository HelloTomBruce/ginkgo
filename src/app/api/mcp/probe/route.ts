import { NextResponse } from "next/server";
import { probeMcpServer } from "@/lib/mcpStore";
import type { MCPServerConfig } from "@ginkgo/harness-core/mcp";

export async function POST(req: Request) {
  try {
    const config = (await req.json()) as MCPServerConfig;
    if (!config || !config.id || !config.transport) {
      return NextResponse.json(
        { error: "探活配置必须包含 id 与 transport" },
        { status: 400 }
      );
    }

    const result = await probeMcpServer(config);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: 0,
        tools: [],
        error: err instanceof Error ? err.message : "探活失败",
      },
      { status: 500 }
    );
  }
}
