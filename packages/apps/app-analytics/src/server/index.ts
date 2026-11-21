import path from "node:path";
import { tool, jsonSchema, type CoreTool } from "ai";
import {
  CertifiedQueryStore,
  matchCertifiedQueries,
  mergeToolSets,
  type ActiveSourceSummary,
  type DatasourceManager,
} from "@openui-analytics/datasources";
import { toAiTools } from "@openui-analytics/datasources/adapters/ai";
import {
  builtinMethodCards,
  createMethodLibrary,
  renderMethodIndex,
  type MethodLibrary,
} from "@openui-analytics/methodology";
import type { CoreMessage } from "ai";
import type {
  AppDeliverableContract,
  AppServerContext,
} from "@openui-analytics/app-sdk";
import {
  getOpenUIPlanPrompt,
  getOpenUISystemPrompt,
  getExecuteSystemPrompt,
} from "./prompt";
import { buildMethodDetailsFromMessages, renderMethodDetailsByIds } from "./methodSelector";
import { extractPlanMethods } from "./planExtractor";
import {
  buildSchemaDigest,
  extractLatestUserQuery,
} from "./schemaDigest";
import {
  defaultCrossSourceRegistry,
  CrossSourceRegistry,
} from "./crossSource";

export * from "./prompt";
export * from "./methodSelector";
export * from "./planExtractor";
export * from "./schemaDigest";
export * from "./crossSource";

/**
 * analytics 应用的交付物契约（注入宿主编排层 createAnalyzeHandler 的 deliverable 选项）：
 * finish_task 终态语义与收尾指令均为数据分析领域文案，证据标记含平台 DSL 标记
 * （```openui）与规划卡组件名（PlanReviewCard）。
 */
export const analyticsDeliverable: AppDeliverableContract = {
  toolDescription:
    "显式宣告分析/规划任务已达成终态并闭环。当数据获取完毕、分析结论和可视化看板或规划卡已就绪时调用。调用此工具表示本轮取数全部结束，无需再发起其他数据查询。",
  rejectReason:
    "尚未输出分析结论、报告或看板，不能宣告 completed。请先完成正式输出；若确属数据缺失或遇到阻塞，请改用 status=insufficient_data 或 status=blocked。",
  wrapUpWithArtifact:
    "数据取数与任务终态已确认闭环。若你在上一步或当前步骤已输出了完整的 Markdown 分析报告与 ```openui 看板代码块，严禁重复输出，直接输出一句简要闭环致辞即可自然结束；若尚未输出报告与看板，请在此处基于已获取的数据输出一份完整的 Markdown 深度分析报告及 ```openui ... ``` 可视化动态看板代码块。每轮回复严格只能有一份报告和一个看板，绝对不可重复输出两遍！",
  wrapUpPlainText: "任务已确认闭环。请直接自然结束当前回复，无需重复输出。",
  evidenceMarkers: ["```openui", "PlanReviewCard"],
};

/** analytics 无 API Key 降级流文案（注入 createAnalyzeHandler 的 noApiKeyMessage 选项） */
export const analyticsNoApiKeyMessage = `⚠️ 请先在右上角「设置」中配置您的 API Key。\n\n\`\`\`openui\nInsightBox(type="warning", title="未检测到 LLM API Key", content="请点击右上角「设置」进入「模型配置」输入 API Key，开启由 Vercel AI SDK 与多数据源 MCP（内置 + 动态配置）驱动的流式数据分析看板。")\n\`\`\``;

/** analytics 会话摘要提示词（注入 createAnalyzeHandler 的 summaryPromptBuilder 选项） */
export function buildAnalyticsSummaryPrompt(opts: {
  covered: CoreMessage[];
  previousSummary?: string;
}): string {
  const textOf = (m: CoreMessage): string => {
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) =>
          p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
            ? (p as { text: string }).text
            : ""
        )
        .join("");
    }
    return "";
  };
  const serialized = opts.covered
    .map((m) => {
      const text = textOf(m);
      const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      return `[${m.role}] ${clipped}`;
    })
    .join("\n\n");
  return `你是一个数据分析会话的压缩器。把下面的会话历史压缩成一份中文摘要（不超过 1200 字），供后续对话作为背景使用。

必须保留：
1. 用户的原始分析目标与每一轮追问
2. 已确认的分析方案（PlanReviewCard 的方法、步骤、数据源选择）
3. 关键结论与数字（指标值、排名、异常点）
4. 用过的数据源、表名、关键字段与过滤条件
5. 未解决的澄清问题或用户偏好

必须丢弃：工具的原始输出细节、看板 DSL 代码、重复的客套话。
${opts.previousSummary ? `\n此前的摘要（请在其基础上增量更新，不要重复劳动）：\n${opts.previousSummary}\n` : ""}
需要压缩的会话历史：
${serialized}`;
}

/** 看板记录的结构投影（宿主 DashboardRecord 的最小结构契约，宿主注入时向上转型） */
export interface AnalyticsDashboardRecordLike {
  id: string;
  appId?: string;
  title: string;
  dsl: string;
  queries?: Array<{
    id: string;
    sourceId: string;
    kind: "sql" | "tool";
    payload: string;
  }>;
  bindings?: Record<string, string>;
  transforms?: Record<string, unknown>;
  dataUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 产物服务依赖（宿主注入其存储单例与刷新引擎；缺省 = 不启用产物协议） */
export interface AnalyticsArtifactServices {
  /** 看板收藏存储（摘要列表/详情读取） */
  dashboards: {
    list(filter?: { appId?: string }): Promise<Array<Omit<AnalyticsDashboardRecordLike, "dsl">>>;
    get(id: string): Promise<AnalyticsDashboardRecordLike | null>;
  };
  /** 活看板刷新引擎（宿主 src/lib/dashboardRefresh 的 refreshDashboard） */
  refreshDashboard?: (
    record: AnalyticsDashboardRecordLike,
    gateway: unknown,
    defaultSourceId?: string
  ) => Promise<
    | { ok: true; dsl: string; stale: string[] }
    | {
        ok: false;
        reason: "readonly" | "dsl-invalid" | "replay-failed" | "source-unavailable";
        error: string;
        sourceId?: string;
      }
  >;
}

export interface AnalyticsServerDeps {
  /** 数据源单例（宿主 src/lib/datasources.ts 注入，包不自建） */
  datasources: DatasourceManager;
  /** 方法论库（可选；缺省内置 10 卡，宿主可注入「内置 + 用户卡」合并库） */
  methodology?: MethodLibrary;
  /** 认证口径知识库（可选；缺省读取 config/certified-queries.json） */
  certifiedStore?: CertifiedQueryStore;
  /** 跨源映射注册表（可选；缺省全局单例） */
  crossSourceRegistry?: CrossSourceRegistry;
  /** 产物服务（可选；宿主注入看板存储与刷新引擎单例） */
  artifacts?: AnalyticsArtifactServices;
}

/**
 * analytics 应用服务端工厂：宿主组合根（api 路由）注入运行时依赖装配。
 * prompt 三模式分发 / 数据源工具与跨源工具装配 / plan→execute 方法卡交接
 * 全部在应用包内自治完成，编排层（@openui-analytics/llm）零 analytics 感知。
 */
export function createAnalyticsServer(deps: AnalyticsServerDeps) {
  const { datasources } = deps;
  const methodLibrary: MethodLibrary =
    deps.methodology ?? createMethodLibrary({ builtin: builtinMethodCards }).library;
  const methodIndexText = renderMethodIndex(methodLibrary.cards);
  const certifiedStore =
    deps.certifiedStore ??
    new CertifiedQueryStore({
      configPath: path.join(process.cwd(), "config/certified-queries.json"),
    });
  const crossSourceRegistry = deps.crossSourceRegistry ?? defaultCrossSourceRegistry;

  /**
   * 装配当前激活的数据源工具（失败源降级跳过，与原编排层行为一致），
   * 返回工具集与携带工具名的源摘要。
   */
  async function loadDataTools(ctx: {
    enabledSources?: string[];
    warn?: (code: string, detail: string) => void;
  }): Promise<{ tools: Record<string, CoreTool>; summaries: ActiveSourceSummary[] }> {
    const enabled =
      Array.isArray(ctx.enabledSources) ? ctx.enabledSources : undefined;
    const activeSources = datasources.resolveActive(enabled);
    const toolEntries: { id: string; tools: Promise<Record<string, CoreTool>> }[] = [];
    for (const s of activeSources) {
      const conf = datasources.get(s.id);
      if (!conf) continue;
      toolEntries.push({
        id: s.id,
        tools: datasources.tools(conf).then((bindings) => toAiTools(bindings, { sourceId: s.id })),
      });
    }
    const settled = await Promise.allSettled(toolEntries.map((e) => e.tools));
    const loadedTools: Record<string, CoreTool> = {};
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        ctx.warn?.(
          "TOOL_LOAD_FAILED",
          `${toolEntries[i].id} 工具加载失败，降级为空工具集: ${
            r.reason instanceof Error ? r.reason.message : String(r.reason)
          }`
        );
        return;
      }
      mergeToolSets(loadedTools, r.value, toolEntries[i].id);
    });
    const summaries: ActiveSourceSummary[] = activeSources.map((s) => {
      const idx = toolEntries.findIndex((e) => e.id === s.id);
      const result = idx >= 0 ? settled[idx] : undefined;
      return result?.status === "fulfilled"
        ? { ...s, tools: Object.keys(result.value) }
        : s;
    });
    return { tools: loadedTools, summaries };
  }

  return {
    requiresDataTools: true as const,

    /** 应用自治工具装配：数据源直连工具 + 跨源映射工具（配对成立时） */
    async getTools(
      ctx: AppServerContext & { warn?: (code: string, detail: string) => void }
    ): Promise<Record<string, CoreTool>> {
      const { tools, summaries } = await loadDataTools(ctx);
      const crossSourcePairs = crossSourceRegistry.resolveCrossSourcePairs(
        summaries.map((s) => s.id)
      );
      if (crossSourcePairs.length === 0) return tools;
      const pairDesc = crossSourcePairs
        .map((p) => `${p.projectSource} ↔ ${p.repoSource}`)
        .join(", ");
      return {
        ...tools,
        cross_source_link: tool({
          description: `查询项目管理侧项目与代码仓库侧仓库的关联映射（当前配对：${pairDesc}），用于跨源联合分析（迭代进度 × 代码活跃度）。映射缺失时返回 confidence=none，此时应提示用户在 config/cross-source-map.json 补充映射，不得编造关联结果。`,
          parameters: jsonSchema<{ project_id: string }>({
            type: "object",
            properties: {
              project_id: {
                type: "string",
                description: "项目管理侧的项目 ID",
              },
            },
            required: ["project_id"],
          }),
          execute: async ({ project_id }) => {
            return crossSourceRegistry.getCrossSourceLinks(project_id);
          },
        }),
      };
    },

    /** 应用自治 System Prompt：三模式分发 + schema 摘要 + 认证口径 + 方法卡注入 */
    async buildSystemPrompt(ctx: AppServerContext): Promise<string> {
      const mode = ctx.mode === "plan" || ctx.mode === "execute" ? ctx.mode : "direct";
      const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
      const userQueryHint =
        ctx.userQuery ?? extractLatestUserQuery(messages);
      // 数据源摘要（自有直连源 + 平台装载的 MCP 源），供 dataAccessSection 渲染。
      // 必须与 getTools 同参数（enabledSources）——prompt 宣称的源 = 实际装配工具的源，
      // 否则模型会对未装配工具的源发起幻觉调用
      const { summaries: dataSummaries } = await loadDataTools({
        enabledSources: ctx.enabledSources,
      });
      const summaries: ActiveSourceSummary[] = [
        ...dataSummaries,
        ...((ctx.activeSources ?? []) as ActiveSourceSummary[]),
      ];
      // 认证口径配置热加载：改 config/certified-queries.json 无需重启进程
      certifiedStore.reloadIfChanged();
      const certifiedMatches = userQueryHint
        ? matchCertifiedQueries(userQueryHint, summaries.map((s) => s.id), certifiedStore)
        : [];
      const schemaDigest = await buildSchemaDigest(datasources, summaries, userQueryHint);

      // execute 模式方法卡注入：WS-4 结构化主路径（pendingPlan）+ 散文兜底
      let methodDetails: string | undefined;
      if (mode === "execute") {
        const sessionCtx =
          ctx.sessionId && ctx.sessions
            ? await ctx.sessions.getContext(ctx.sessionId).catch(() => undefined)
            : undefined;
        const pendingIds = sessionCtx?.pendingPlan?.methodIds ?? [];
        if (pendingIds.length > 0) {
          methodDetails = renderMethodDetailsByIds(methodLibrary, pendingIds);
          // 消费即清空(置空数组,增量合并语义可落盘),防陈旧规划被后续 execute 复用
          if (ctx.sessionId && ctx.sessions) {
            void ctx.sessions
              .updateContext(ctx.sessionId, { pendingPlan: { methodIds: [] } })
              .catch(() => {});
          }
        } else {
          methodDetails = buildMethodDetailsFromMessages(methodLibrary, messages);
          if (methodDetails) {
            console.warn(
              "[analytics] pendingPlan 缺失，execute 回退到散文匹配提取方法（PLAN_FALLBACK_LEGACY）"
            );
          }
        }
      }

      if (mode === "plan") {
        return getOpenUIPlanPrompt(summaries, schemaDigest.text, methodIndexText, certifiedMatches);
      }
      if (mode === "execute") {
        return getExecuteSystemPrompt(summaries, schemaDigest.text, methodDetails, certifiedMatches);
      }
      return getOpenUISystemPrompt(summaries, schemaDigest.text, methodIndexText, certifiedMatches);
    },

    /** 任务收尾钩子：plan 阶段从最终文本提取结构化 methods，登记为 pendingPlan */
    async onTaskFinish(event: {
      sessionId?: string;
      mode: "direct" | "plan" | "execute";
      finalText?: string;
      sessions?: {
        updateContext(sessionId: string, patch: { pendingPlan?: { methodIds: string[] } }): Promise<void>;
      };
    }): Promise<void> {
      const { sessionId, mode, finalText, sessions } = event;
      if (mode !== "plan" || !sessionId || !sessions) return;
      const planIds = extractPlanMethods(finalText ?? "");
      if (planIds.length > 0) {
        await sessions
          .updateContext(sessionId, { pendingPlan: { methodIds: planIds } })
          .catch(() => {});
      }
    },

    /** 产物列表（平台产物协议）：看板收藏 → AppArtifactItem 投影 */
    async listArtifacts(ctx: { appId: string }): Promise<
      Array<{
        id: string;
        name: string;
        type: string;
        updatedAt: number;
      }>
    > {
      if (!deps.artifacts) return [];
      const summaries = await deps.artifacts.dashboards.list({
        appId: ctx.appId,
      });
      return summaries.map((s) => ({
        id: s.id,
        name: s.title,
        type: "dashboard",
        updatedAt: s.updatedAt,
      }));
    },

    /** 活产物刷新（平台产物协议，compute-only）：委托宿主刷新引擎重放取数回填 DSL */
    async refreshArtifact(input: {
      artifactId: string;
    }): Promise<
      | { ok: true; payload: string; stale?: string[] }
      | { ok: false; reason: string; error?: string }
    > {
      const { artifacts } = deps;
      if (!artifacts?.refreshDashboard) {
        return { ok: false, reason: "unsupported", error: "未注入刷新引擎" };
      }
      const record = await artifacts.dashboards.get(input.artifactId);
      if (!record) {
        return { ok: false, reason: "not-found", error: `产物不存在: ${input.artifactId}` };
      }
      const verdict = await artifacts.refreshDashboard(
        record,
        deps.datasources as unknown
      );
      if (!verdict.ok) {
        return { ok: false, reason: verdict.reason, error: verdict.error };
      }
      return { ok: true, payload: verdict.dsl, stale: verdict.stale };
    },
  };
}

export type AnalyticsServer = ReturnType<typeof createAnalyticsServer>;
