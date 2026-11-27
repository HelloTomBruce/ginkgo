import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getPluginsDir } from "@/lib/storagePaths";
import { loadAppsConfig } from "@/lib/apps/appConfigServer";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

/**
 * 提供已安装第三方应用的客户端静态构建产物（微前端动态加载支撑）。
 * GET /api/apps/[appId]/assets/[...file]
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ appId: string; file: string[] }> }
) {
  try {
    const { appId, file } = await context.params;
    if (!file || file.length === 0) {
      return NextResponse.json({ error: "File path missing" }, { status: 400 });
    }

    // 防路径穿越
    const relativePath = file.join("/");
    if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const config = await loadAppsConfig();
    const entry = config.apps.find((a) => a.id === appId);

    if (!entry || !entry.package || entry.builtin) {
      return NextResponse.json(
        { error: `App ${appId} does not provide dynamic assets` },
        { status: 404 }
      );
    }

    const pluginsDir = getPluginsDir();
    // 默认寻找包的 dist/ 目录或者根目录
    const candidatePaths = [
      path.join(pluginsDir, "node_modules", entry.package, "dist", relativePath),
      path.join(pluginsDir, "node_modules", entry.package, relativePath),
    ];

    let targetFile: string | null = null;
    for (const p of candidatePaths) {
      try {
        await fs.access(p);
        targetFile = p;
        break;
      } catch {
        // 继续尝试
      }
    }

    if (!targetFile) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const ext = path.extname(targetFile).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(targetFile);

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // 应用升级会原地替换文件而 URL 不含版本段，immutable 会让浏览器一年不拉新；
        // 待加载方接入后应改为 /assets/client.js?v=<版本> 的版本化 URL 再恢复 immutable
        "Cache-Control": "public, max-age=300",
        // 直出 SVG/HTML 类内容时阻断其内嵌脚本在平台源上执行（作为子资源加载时
        // 此头被浏览器忽略，不影响微前端 <script> 注入）
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err: unknown) {
    // 不回传 err.message——里面可能带服务器绝对路径等内部信息
    console.error("[app-assets] 读取失败:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
