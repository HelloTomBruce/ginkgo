import { createAnalyzeHandler } from "@openui-analytics/llm";
import {
  compositeSink,
  createConsoleSink,
  createMetricsSink,
} from "@openui-analytics/harness-core";
import { datasources } from "@/lib/datasources";
import { getMcpManager, loadMcpServers } from "@/lib/mcpStore";
import { createAppMethodology } from "@/lib/methodologyLoader";
import { sessionStore } from "@/lib/sessionStore";
import { appRegistry } from "@/lib/apps/registry";
import { resolveWorkspaceContext } from "@/lib/workspaceResolver";
import { workspaceStore } from "@/lib/workspaceStore";
import { getGeneralTools } from "@openui-apps/general/server";

/**
 * WS-10 鉴权接缝桩：当前应用无成熟认证体系，开发模式全部放行并归入匿名租户
 * "anon"（与包内未注入 authenticate 的缺省行为完全等价）；
 * 接入真实认证体系（API key 校验 / 会话 cookie）后替换此实现。
 * 注意：真实认证落地时 GET 探针与 /api/usage 需同步传入同一租户解析结果
 * （否则跨租户任务在探针上静默不可见）。
 */
console.warn(
  "[llm] authenticate 未接入真实认证体系：开发模式放行，全部请求归入匿名租户（进程级提示一次）"
);
const devModeAuthenticate = async () => ({ principal: "anon" });

/** WS-13 Prometheus 指标聚合：进程内单例，/api/metrics 刮擦导出 */
export const metrics = createMetricsSink();

/**
 * 薄壳：LLM 编排在 @openui-analytics/llm，数据源单例与方法论库由应用注入。
 * 方法论库 = 内置 10 卡 + data/methodology/*.json 用户卡（启动加载一次，坏卡跳过不阻塞）。
 * sessions：上下文治理的会话元数据存取（token 锚点与摘要缓存，增量合并语义）。
 * telemetry：NDJSON console（可 grep）+ 进程内指标聚合双写；接 OTel 时换
 * compositeSink(console, otelSink, metrics.sink)。
 */
export const POST = createAnalyzeHandler({
  authenticate: devModeAuthenticate,
  datasources,
  mcp: {
    manager: getMcpManager(),
    getServers: () => loadMcpServers(),
  },
  methodology: createAppMethodology().library,
  sessions: {
    async getContext(sessionId) {
      const record = await sessionStore.get(sessionId);
      return record?.context;
    },
    async updateContext(sessionId, patch) {
      await sessionStore.update(sessionId, { context: patch });
    },
  },
  resolveAppPrompt: async (appId, ctx) => {
    // 数据分析保持原有深度编排（SQL探查、指标计算与认证口径）
    if (appId === "analytics") return undefined;
    const app = appRegistry.get(appId);
    if (app?.server?.buildSystemPrompt) {
      let customRootDir: string | undefined;
      if (ctx.sessionId) {
        const sRecord = await sessionStore.get(ctx.sessionId);
        if (sRecord?.workspaceId) {
          const ws = await workspaceStore.get(sRecord.workspaceId);
          if (ws?.path) customRootDir = ws.path;
        }
      }
      const workspace = await resolveWorkspaceContext({
        appId,
        sessionId: ctx.sessionId,
        customRootDir,
      });
      return app.server.buildSystemPrompt({
        appId,
        sessionId: ctx.sessionId,
        workspace,
        mode: ctx.mode,
        messages: ctx.messages,
      });
    }
    return undefined;
  },
  resolveAppTools: async (appId, ctx) => {
    let customRootDir: string | undefined;
    if (ctx.sessionId) {
      const sRecord = await sessionStore.get(ctx.sessionId);
      if (sRecord?.workspaceId) {
        const ws = await workspaceStore.get(sRecord.workspaceId);
        if (ws?.path) customRootDir = ws.path;
      }
    }
    const workspace = await resolveWorkspaceContext({
      appId,
      sessionId: ctx.sessionId,
      customRootDir,
    });
    if (appId === "general") {
      return getGeneralTools({
        appId,
        sessionId: ctx.sessionId,
        workspace,
        mode: ctx.mode,
        messages: ctx.messages,
      });
    }
    const app = appRegistry.get(appId);
    if (!app?.server?.getTools) return undefined;
    const tools = await app.server.getTools({
      appId,
      sessionId: ctx.sessionId,
      workspace,
      mode: ctx.mode,
      messages: ctx.messages,
    });
    return tools as Record<string, never>;
  },
  isDataApp: (appId) => {
    const app = appRegistry.get(appId);
    return app?.server?.requiresDataTools ?? (appId === "analytics");
  },
  telemetry: compositeSink(createConsoleSink(), metrics.sink),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ running: false });
  }
  // hasTask：任务存在（含 running 与终态保留 30s 的 completed/error）。
  // 客户端脱钩切换期间任务可能在后台跑完——此时 running=false 但仍有未落盘内容，
  // 探测须按 hasTask 触发重连重放收尾，否则尾巴内容随 30s 清理永久丢失
  const [running, hasTask] = await Promise.all([
    POST.isSessionRunning(sessionId),
    POST.streamHub.hasTask(sessionId),
  ]);
  return Response.json({ running, hasTask });
}
