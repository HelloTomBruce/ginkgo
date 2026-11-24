import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { zodTool } from "@ginkgo/harness-core";
import { createSandboxTools } from "@ginkgo/sandbox";
import type { AppServerContext } from "@ginkgo/app-sdk";
import { CliBridge } from "./cliBridge";

export function createDesignTools(workspaceDir: string, isReadonly: boolean = false) {
  // 1. 基础沙箱文件工具（读写 .dc.html / canvas.json 等）
  const sandboxTools = createSandboxTools({
    sandboxDir: workspaceDir,
    preset: "atomic",
    permission: isReadonly ? "readonly" : "full",
  });

  // 2. 设计系统与画板专用工具
  const design_canvas_init = zodTool({
    description: "在工作区初始化画板项目结构，创建标准的 project/canvas.json 与首个 Main.dc.html 画板文件骨架",
    parameters: z.object({
      title: z.string().describe("画板项目标题，例如 '用户增长分析看板'、'移动端登录流'"),
      width: z.number().optional().default(880).describe("初始主画板宽度（默认 880px）"),
      height: z.number().optional().default(560).describe("初始主画板高度（默认 560px）"),
    }),
    execute: async ({ title, width, height }) => {
      if (isReadonly) {
        return {
          error: "当前处于 Plan 规划模式（只读）。请向用户阐述设计思路并获得确认后，再在构建阶段执行初始化。",
          isError: true,
        };
      }
      try {
        const projectDir = path.join(workspaceDir, "project");
        await fs.mkdir(projectDir, { recursive: true });

        const canvasJsonPath = path.join(projectDir, "canvas.json");
        const mainDcPath = path.join(projectDir, "Main.dc.html");

        const canvasData = {
          v: 3,
          createdOnFiles: { v: 1, at: new Date().toISOString() },
          title,
          launch: { view: "canvas" },
          pages: [],
          boards: {
            "Main.dc.html": { x: 0, y: 0, w: width, h: height, title },
          },
          order: ["Main.dc.html"],
          notes: {},
          designSystems: [],
        };

        const mainDcHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; }
</style>
</helmet>
<div style="width: ${width}px; height: ${height}px; box-sizing: border-box; padding: 48px; display: flex; flex-direction: column; gap: 24px;">
  <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px;">
    <h1 style="margin: 0; font-size: 36px; font-weight: 700; color: #38bdf8;">${title}</h1>
    <p style="margin: 8px 0 0 0; font-size: 15px; color: #94a3b8;">由 Ginkgo Design Studio 自动构建</p>
  </div>
  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
    <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px;">
      <div style="font-size: 13px; color: #94a3b8;">关键指标 A</div>
      <div style="font-size: 28px; font-weight: 700; margin-top: 8px; color: #f8fafc;">98.4%</div>
    </div>
    <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px;">
      <div style="font-size: 13px; color: #94a3b8;">业务增长 B</div>
      <div style="font-size: 28px; font-weight: 700; margin-top: 8px; color: #10b981;">+24.8%</div>
    </div>
    <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px;">
      <div style="font-size: 13px; color: #94a3b8;">活跃响应 C</div>
      <div style="font-size: 28px; font-weight: 700; margin-top: 8px; color: #6366f1;">42ms</div>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${width},"height":${height}}}'>
class Component extends DCLogic {
  renderVals() {
    return {};
  }
}
</script>
</body>
</html>
`;

        await fs.writeFile(canvasJsonPath, JSON.stringify(canvasData, null, 2) + "\n", "utf-8");
        await fs.writeFile(mainDcPath, mainDcHtml, "utf-8");

        return {
          success: true,
          message: `已成功初始化画板项目: ${title}。主画板文件已创建: project/Main.dc.html (${width}x${height})`,
          canvasJsonPath: "project/canvas.json",
          mainDcPath: "project/Main.dc.html",
        };
      } catch (err: unknown) {
        return {
          error: `初始化画板失败: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  });

  const design_canvas_check = zodTool({
    description: "调用 claude-design check 对当前工作区的画板文件进行静态结构和语法合规性检查",
    parameters: z.object({}),
    execute: async () => {
      const result = await CliBridge.checkCanvas(workspaceDir);
      return result;
    },
  });

  const design_canvas_serve = zodTool({
    description: "启动或查询当前画板的本地实时预览服务 (claude-design open)，返回本地 URL 供右侧工作台呈现",
    parameters: z.object({}),
    execute: async () => {
      const result = await CliBridge.serveCanvas(workspaceDir);
      return result;
    },
  });

  const design_canvas_stop = zodTool({
    description: "停止当前工作区正在运行的画板本地预览服务",
    parameters: z.object({}),
    execute: async () => {
      const result = await CliBridge.stopCanvas(workspaceDir);
      return result;
    },
  });

  const design_system_audit = zodTool({
    description: "调用 claude-design-system audit 扫描指定目录的前端源码，检查是否硬编码颜色或违规使用样式 Token",
    parameters: z.object({
      targetDir: z.string().optional().describe("待审查的目标代码目录，缺省为当前工作区根目录"),
    }),
    execute: async ({ targetDir }) => {
      const scanDir = targetDir ? path.resolve(workspaceDir, targetDir) : workspaceDir;
      const result = await CliBridge.auditDesignSystem(scanDir);
      return result;
    },
  });

  return {
    ...sandboxTools,
    design_canvas_init,
    design_canvas_check,
    design_canvas_serve,
    design_canvas_stop,
    design_system_audit,
  };
}

export function getDesignTools(ctx: AppServerContext) {
  const workspaceDir =
    ctx.workspace?.sandboxDir ||
    path.join(process.cwd(), "data", "workspaces", "design", ctx.sessionId || "default");
  const isReadonly = ctx.mode === "plan";
  return createDesignTools(workspaceDir, isReadonly);
}
