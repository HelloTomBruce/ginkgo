import path from "node:path";
import type { AppServerContext } from "@openui-analytics/app-sdk";
import { createSandboxTools } from "@openui-analytics/sandbox";

/**
 * 通用助手的沙箱工具装配（运行时实现，仅服务端经 `@openui-apps/general/server`
 * 入口消费——宿主组合根 runtimeServers 注入；不得进应用包主入口，否则 Node
 * 内置模块泄漏进客户端 bundle）。
 *
 * 消费平台 openui-sandbox 能力包（atomic 预设 = read/edit/write/bash 四原子
 * 工具）。宿主经 ctx.workspace 注入沙箱目录；缺失时降级进程内默认沙箱
 * （与宿主 workspaceResolver 的缺省路径一致），保证独立装配场景可用。
 *
 * mode 联动权限（应用策略，能力包只提供档位）：plan 阶段（先方案后执行）
 * 收敛为只读——写入与命令执行在方案经用户确认（execute 请求）后解锁。
 */
export function getGeneralTools(ctx: AppServerContext) {
  const sandboxDir =
    ctx.workspace?.sandboxDir ||
    path.join(process.cwd(), "data", "workspaces", "general", ctx.sessionId || "default");
  return createSandboxTools({
    sandboxDir,
    preset: "atomic",
    permission: ctx.mode === "plan" ? "readonly" : "full",
  });
}
