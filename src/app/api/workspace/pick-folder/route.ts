import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { workspaceStore } from "@/lib/workspaceStore";

const execAsync = promisify(exec);

/**
 * POST /api/workspace/pick-folder
 * 触发操作系统原生文件夹选择框，获取用户选中的绝对目录，并注册为工作区
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const appId = body.appId || "general";

    let folderPath: string | null = null;

    if (os.platform() === "darwin") {
      // macOS: 强制激活置顶系统选择器窗口，防止被浏览器窗口遮挡
      const script = `osascript -e 'tell application "System Events" to activate' -e 'POSIX path of (choose folder with prompt "选择工作区工程目录")'`;
      try {
        const { stdout } = await execAsync(script);
        const picked = stdout.trim();
        // 去除末尾斜杠
        folderPath = picked.replace(/\/+$/, "");
      } catch (err: unknown) {
        const msg = String(err);
        if (msg.includes("User canceled") || msg.includes("error number -128")) {
          return NextResponse.json({ canceled: true });
        }
        throw err;
      }
    } else {
      // 非 macOS（如 Windows / Linux / CI 环境）若传入了 folderPath 则采用，否则返回提示
      if (typeof body.path === "string" && body.path.trim()) {
        folderPath = path.resolve(body.path.trim());
      } else {
        return NextResponse.json(
          { error: "当前系统暂不支持原生对话框，请在输入框直接填入工作区绝对路径" },
          { status: 400 }
        );
      }
    }

    if (!folderPath) {
      return NextResponse.json({ canceled: true });
    }

    // 提取文件夹名作为工作区名
    const folderName = path.basename(folderPath) || "workspace";

    // 注册或查找工作区
    const workspace = await workspaceStore.create({
      name: folderName,
      path: folderPath,
      appId,
    });

    return NextResponse.json({
      success: true,
      workspace,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "文件夹选择失败" },
      { status: 500 }
    );
  }
}
