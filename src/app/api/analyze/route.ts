import { createAnalyzeHandler } from "@ginkgolab/llm";
import {
  compositeSink,
  createConsoleSink,
  createMetricsSink,
  ModelPricingTable,
} from "@ginkgolab/harness-core";
import { getMcpManager, loadMcpServers } from "@/lib/mcpStore";
import { sessionStore } from "@/lib/sessionStore";
import { appRegistry, DEFAULT_APP_ID } from "@/lib/apps/registry";
import { gateAppTools } from "@/lib/apps/permissionGate";
import {
  analyticsDeliverable,
  analyticsNoApiKeyMessage,
  buildAnalyticsSummaryPrompt,
} from "@ginkgolab/app-analytics/server";
import { resolveRuntimeServer } from "@/lib/apps/runtimeServers";
import { analyticsServer } from "@/lib/analyticsRuntime";
import { resolveWorkspaceForSession } from "@/lib/workspaceResolver";
import {
  getModelPricingFile,
  getTokenizerConfigFile,
} from "@/lib/storagePaths";

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
 * 薄壳：LLM 编排在 @ginkgolab/llm（领域中立），应用 prompt/工具全部经
 * resolveAppPrompt / resolveAppTools 接缝注入（无 appId 特判：general 的沙箱
 * 工具在应用包内消费 ginkgo-sandbox 能力包装配，宿主只按 needsWorkspace 声明
 * 注入会话沙箱）；analytics 的深度编排（schema 摘要、方法卡、认证口径、跨源
 * 工具）在 @ginkgolab/app-analytics 服务端自治。
 * telemetry：NDJSON console（可 grep）+ 进程内指标聚合双写；接 OTel 时换
 * compositeSink(console, otelSink, metrics.sink)。
 */
export const POST = createAnalyzeHandler({
  authenticate: devModeAuthenticate,
  defaultAppId: DEFAULT_APP_ID,
  mcp: {
    manager: getMcpManager(),
    getServers: () => loadMcpServers(),
  },
  sessions: {
    async getContext(sessionId) {
      const record = await sessionStore.get(sessionId);
      return record?.context;
    },
    async updateContext(sessionId, patch) {
      await sessionStore.update(sessionId, { context: patch });
    },
  },
  // 计费口径与 tokenizer 映射随存储根解析（不再固定 cwd）：存储根外移后仍读同一份配置
  pricing: new ModelPricingTable(getModelPricingFile()),
  tokenizerConfigPath: getTokenizerConfigFile(),
  deliverable: analyticsDeliverable,
  noApiKeyMessage: analyticsNoApiKeyMessage,
  summaryPromptBuilder: buildAnalyticsSummaryPrompt,
  resolveAppPrompt: async (appId, ctx) => {
    const server = resolveRuntimeServer(appId);
    if (!server?.buildSystemPrompt) {
      // 已停用/未注册应用：调用方应回落默认应用；此处显式记录，避免"没工具"没人知道为什么
      if (!appRegistry.isAppEnabled(appId)) {
        console.warn(`[analyze] 应用 [${appId}] 未启用，跳过其系统提示注入`);
      }
      return undefined;
    }
    const workspace = server.needsWorkspace
      ? await resolveWorkspaceForSession(appId, ctx.sessionId)
      : undefined;
    return server.buildSystemPrompt({
      appId,
      sessionId: ctx.sessionId,
      ...(workspace ? { workspace } : {}),
      mode: ctx.mode,
      messages: ctx.messages,
      userQuery: ctx.userQuery,
      enabledSources: ctx.enabledSources,
      activeSources: ctx.activeSources,
      sessions: ctx.sessions,
    });
  },
  resolveAppTools: async (appId, ctx) => {
    const server = resolveRuntimeServer(appId);
    if (!server?.getTools) {
      if (!appRegistry.isAppEnabled(appId)) {
        console.warn(`[analyze] 应用 [${appId}] 未启用，跳过其工具装配`);
      }
      return undefined;
    }
    const workspace = server.needsWorkspace
      ? await resolveWorkspaceForSession(appId, ctx.sessionId)
      : undefined;
    const tools = await server.getTools({
      appId,
      sessionId: ctx.sessionId,
      ...(workspace ? { workspace } : {}),
      mode: ctx.mode,
      messages: ctx.messages,
      userQuery: ctx.userQuery,
      enabledSources: ctx.enabledSources,
      activeSources: ctx.activeSources,
      sessions: ctx.sessions,
      ...(ctx.warn ? { warn: ctx.warn } : {}),
    });

    // 权限门禁（模型 v1）：声明了 manifest.permissions 的应用按 toolPermissions
    // 白名单过滤，未映射的工具一律丢弃；内置应用（未声明）不受影响。
    const gated = gateAppTools(appId, server.toolPermissions, tools);
    if (Object.keys(gated.stripped).length > 0) {
      console.warn(
        `[analyze] 应用 [${appId}] 有 ${Object.keys(gated.stripped).length} 个工具因权限被剥离:`,
        gated.stripped
      );
    }

    return gated.tools as Record<string, never>;
  },
  onTaskFinish: (event) =>
    analyticsServer.onTaskFinish({
      sessionId: event.sessionId,
      mode: event.mode,
      finalText: event.finalText,
      sessions: event.sessions,
    }),
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
