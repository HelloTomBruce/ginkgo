import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceContext, resolveSafeWorkspacePath } from "@/lib/workspaceResolver";

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", ".DS_Store"]);

interface WorkspaceFileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt: number;
}

/**
 * GET /api/workspace
 * 查询工作区文件树或单个文件内容
 * - ?appId=general&sessionId=xxx : 返回文件树列表
 * - ?appId=general&sessionId=xxx&filePath=src/index.ts : 返回文件文本内容
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appId = searchParams.get("appId") || "general";
    const sessionId = searchParams.get("sessionId") || "default";
    const filePath = searchParams.get("filePath");

    const ws = await resolveWorkspaceContext({ appId, sessionId });

    // 1. 若指定了 filePath，读取文件内容
    if (filePath) {
      const safeFile = resolveSafeWorkspacePath(ws.sandboxDir, filePath);
      try {
        const stat = await fs.stat(safeFile);
        if (!stat.isFile()) {
          return NextResponse.json({ error: "目标路径不是普通文件" }, { status: 400 });
        }
        const content = await fs.readFile(safeFile, "utf-8");
        return NextResponse.json({
          path: filePath,
          size: stat.size,
          updatedAt: stat.mtimeMs,
          content,
        });
      } catch {
        return NextResponse.json({ error: "文件不存在或无法读取" }, { status: 404 });
      }
    }

    // 2. 未指定 filePath，扫描工作区文件树
    async function scan(currentDir: string, depth = 1): Promise<WorkspaceFileItem[]> {
      if (depth > 4) return [];
      const dirEntries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      const items: WorkspaceFileItem[] = [];

      for (const entry of dirEntries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const full = path.join(currentDir, entry.name);
        const rel = path.relative(ws.sandboxDir, full);

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            path: rel,
            type: "directory",
            updatedAt: Date.now(),
          });
          const sub = await scan(full, depth + 1);
          items.push(...sub);
        } else if (entry.isFile()) {
          const stat = await fs.stat(full).catch(() => null);
          items.push({
            name: entry.name,
            path: rel,
            type: "file",
            size: stat?.size,
            updatedAt: stat?.mtimeMs ?? Date.now(),
          });
        }
      }
      return items;
    }

    const files = await scan(ws.sandboxDir);
    return NextResponse.json({
      appId,
      sessionId,
      sandboxDir: ws.sandboxDir,
      count: files.length,
      files,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "工作区查询失败" },
      { status: 500 }
    );
  }
}
