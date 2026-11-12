import {
  streamText,
  generateText,
  tool,
  jsonSchema,
  createDataStreamResponse,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type CoreMessage,
  type CoreTool,
} from "ai";
import {
  computeBudget,
  estimateTextTokens,
  projectMessages,
  resolveContextWindow,
  trimAfterSummaryCut,
  buildSummaryPrompt,
  SUMMARY_MAX_TOKENS,
} from "./context";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  mergeToolSets,
  renderCardForPrompt,
  type ActiveSourceSummary,
  type DatasourceManager,
} from "@openui-analytics/datasources";
import { toAiTools } from "@openui-analytics/datasources/adapters/ai";
import {
  builtinMethodCards,
  createMethodLibrary,
  renderMethodIndex,
  renderCardDetail,
  type MethodLibrary,
} from "@openui-analytics/methodology";
import { getOpenUISystemPrompt, getOpenUIPlanPrompt, getExecuteSystemPrompt } from "./prompt";
import { getCrossSourceLinks, resolveCrossSourcePairs } from "./crossSourceMap";
import { SessionStreamHub, defaultStreamHub } from "./streamHub";
import { createReasoningFetch } from "./reasoningStream";

/** 全部启用源结构卡注入 prompt 的总量预算（与单卡 2KB 预算配套，快照测试守护） */
export const SCHEMA_DIGEST_TOTAL_BUDGET_BYTES = 8 * 1024;

/**
 * 组装启用源的结构卡摘要：逐源读卡（渲染职责在 datasources 包），
 * 依据用户提问相关度优先展开核心表，按总量预算降序纳入，超限的源省略并标注。
 * 读卡失败静默跳过（不阻塞分析）。
 */
async function buildSchemaDigest(
  datasources: DatasourceManager,
  activeSources: ActiveSourceSummary[],
  queryHint?: string
): Promise<string | undefined> {
  if (activeSources.length === 0) return undefined;
  const sections: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const s of activeSources) {
    try {
      const got = await datasources.getSchemaCard(s.id);
      if (!got) continue;
      const text = renderCardForPrompt(got.card, { queryHint });
      const bytes = Buffer.byteLength(text, "utf-8");
      if (used + bytes > SCHEMA_DIGEST_TOTAL_BUDGET_BYTES) {
        omitted++;
        continue;
      }
      sections.push(text);
      used += bytes;
    } catch {
      // 读卡失败不阻塞分析
    }
  }
  if (sections.length === 0) return undefined;
  if (omitted > 0) {
    sections.push(`（另有 ${omitted} 个数据源的结构卡因总量预算省略，可用工具现场探查）`);
  }
  return sections.join("\n\n");
}

/** 提取对话历史中最后一条用户提问文本作为表画像召回提示词 */
function extractLatestUserQuery(messages: unknown[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (m && m.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((p) =>
            typeof p === "object" && p && "text" in p ? String(p.text) : ""
          )
          .join(" ");
      }
    }
  }
  return undefined;
}

/**
 * execute 模式方法提取：从消息历史**最近一条 assistant 消息**（即待执行的
 * PlanReviewCard 规划）中匹配方法 id（词边界）或卡名（中文语境兜底），
 * 命中卡按需注入详情（≤2 张，与 plan 阶段「选 1~2 个方法」契约一致）。
 * 未命中返回 undefined（execute prompt 回落到无详情的增量约束）。
 */
export function buildMethodDetailsFromMessages(
  library: MethodLibrary,
  messages: unknown[]
): string | undefined {
  let lastAssistant: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (!m || m.role !== "assistant") continue;
    lastAssistant = typeof m.content === "string" ? m.content : undefined;
    break;
  }
  if (!lastAssistant) return undefined;

  const matched: string[] = [];
  for (const card of library.cards) {
    if (matched.length >= 2) break;
    const idRe = new RegExp(`\\b${card.id}\\b`, "i");
    if (idRe.test(lastAssistant) || lastAssistant.includes(card.name)) {
      matched.push(renderCardDetail(card));
    }
  }
  return matched.length > 0 ? matched.join("\n\n") : undefined;
}

/** 会话上下文元数据（投影式压缩的锚点与摘要缓存；与应用层 SessionContextMeta 同构） */
export interface SessionContextMeta {
  lastPromptTokens?: number;
  summary?: string;
  summaryUptoMessageId?: string;
}

/**
 * 会话上下文存取（可选注入）：缺省时上下文治理退化为「仅当次启发式估算」
 * （无跨轮锚点、无摘要缓存；pruning 仍生效）。
 */
export interface SessionContextStore {
  getContext(sessionId: string): Promise<SessionContextMeta | undefined>;
  /** 增量合并语义（只更新 patch 中出现的字段） */
  updateContext(sessionId: string, patch: SessionContextMeta): Promise<void>;
}

export interface AnalyzeHandlerOptions {
  /** 应用持有的数据源单例（src/lib/datasources.ts），包不自建 */
  datasources: DatasourceManager;
  /**
   * 方法论库（可选注入）：缺省用内置 10 卡装配（内置卡由 promptExamples.test
   * 的组件名一致性校验守护）；应用层可注入「内置 + 用户卡/业务包卡」合并库。
   */
  methodology?: MethodLibrary;
  /** 会话上下文存取（可选注入；应用层为 src/lib/sessionStore 的适配器） */
  sessions?: SessionContextStore;
  /** 会话流中继中枢（可选注入；缺省全局单例 defaultStreamHub） */
  streamHub?: SessionStreamHub;
}

export interface AnalyzeRequestBody {
  action?: string;
  reconnect?: boolean;
  messages?: unknown[];
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number | string;
  /**
   * 输出 token 上限（每个生成步）：
   * - Anthropic 协议端点强制要求 max_tokens，provider 缺省仅 4096，推理型模型思考阶段即烧尽，
   *   造成 finishReason=length 的静默截断（无文本、无后续工具调用）
   * - 可选，钳制 1024–65536；缺省 16384（可由环境变量 LLM_MAX_OUTPUT_TOKENS 覆盖默认值）
   */
  maxTokens?: number | string;
  sources?: string[];
  /** 接口协议：anthropic（如 Kimi Coding 的 /v1/messages）或缺省 openai 兼容（/chat/completions） */
  protocol?: "openai" | "anthropic";
  /**
   * 分析阶段（Plan-first 两阶段编排）：
   * - direct（缺省）：直接分析产出看板
   * - plan：规划确认阶段——仅探查表结构 + LIMIT 小样本，输出 PlanReviewCard 思路确认卡
   * - execute：执行阶段——按历史中已确认的规划产出完整看板
   */
  mode?: "direct" | "plan" | "execute";
  /** 会话 id（上下文治理：读取/回写计量锚点与摘要缓存；缺省则治理降级） */
  sessionId?: string;
  /** 客户端提供的模型窗口 hint（provider catalog 值；缺省服务端查表） */
  contextWindow?: number | string;
  /** 步数上限（Agent 循环熔断兜底），缺省 plan 6 步，execute/direct 10 步 */
  maxSteps?: number | string;
  /** 历史透传字段（如 gitlabUrl/gitlabToken）被忽略的现状保持 */
  [key: string]: unknown;
}

/**
 * LLM 编排门面：注入数据源单例，返回可直接作为 Next POST 路由的处理函数。
 * 逻辑与原 app/api/analyze/route.ts 逐行等价（仅依赖来源改为注入）。
 */
export function createAnalyzeHandler(opts: AnalyzeHandlerOptions) {
  const { datasources, sessions } = opts;
  const streamHub = opts.streamHub ?? defaultStreamHub;

  // 方法论库：注入或缺省内置；索引文本在工厂期渲染一次（库不变无需逐请求重算）
  const methodLibrary: MethodLibrary =
    opts.methodology ??
    createMethodLibrary({ builtin: builtinMethodCards }).library;
  const methodIndexText = renderMethodIndex(methodLibrary.cards);

  const POST = async function (req: Request) {
    try {
      const rawBody = (await req.json()) as AnalyzeRequestBody;
      if (rawBody && typeof rawBody === "object" && rawBody.action === "stop") {
        const sid = rawBody.sessionId;
        if (sid) {
          streamHub.abortTask(sid);
        }
        return Response.json({ ok: true, stopped: true });
      }

      const {
        messages = [],
        apiKey: clientKey,
        baseURL: clientBaseURL,
        model: clientModel,
        temperature: clientTemperature,
        maxTokens: clientMaxTokens,
        sources: clientSources,
        protocol: clientProtocol,
        mode: clientMode,
        sessionId: clientSessionId,
        contextWindow: clientContextWindow,
        maxSteps: clientMaxSteps,
      } = rawBody;

      // 检查是否为流重连请求（如页面刷新后客户端发起无缝续接）：
      // 若带有 reconnect 标记且服务端保留有该会话在途或刚完成的流任务，直接返回重连流
      const isReconnect = Boolean(rawBody && typeof rawBody === "object" && rawBody.reconnect);
      if (clientSessionId && isReconnect && streamHub.hasTask(clientSessionId)) {
        console.log(`[StreamHub] Reconnecting to task for session ${clientSessionId}`);
        const reconnResp = streamHub.createResponse(clientSessionId);
        if (reconnResp) return reconnResp;
      }

      const apiKey = clientKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
      const baseURL = clientBaseURL || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
      const model = clientModel || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
      // 温度由客户端设置页透传，钳制在 0–2，默认 0.2（数据分析场景）
      const parsedTemp = Number(clientTemperature);
      const temperature =
        Number.isFinite(parsedTemp) && clientTemperature !== undefined && clientTemperature !== ""
          ? Math.min(Math.max(parsedTemp, 0), 2)
          : 0.2;

      // 输出 token 上限：请求体 maxTokens 优先，其次 LLM_MAX_OUTPUT_TOKENS，缺省 16384；钳制 1024–65536
      const envMaxTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
      const parsedMaxTokens = Number(clientMaxTokens);
      const maxOutputTokensBase =
        Number.isFinite(parsedMaxTokens) && clientMaxTokens !== undefined && clientMaxTokens !== ""
          ? parsedMaxTokens
          : Number.isFinite(envMaxTokens) && process.env.LLM_MAX_OUTPUT_TOKENS !== undefined
            ? envMaxTokens
            : 16384;
      const maxOutputTokens = Math.min(Math.max(Math.round(maxOutputTokensBase), 1024), 65536);

      // 分析阶段归一化：非法值回落 direct，保持向后兼容
      const mode =
        clientMode === "plan" || clientMode === "execute" ? clientMode : "direct";

      // 步数预算（maxSteps 熔断上限）：客户端透传优先，其次环境变量 LLM_PLAN_MAX_STEPS / LLM_MAX_STEPS，
      // 缺省时默认 25 步（防死循环熔断上限；双重终态机制保证模型在目标达成时通过 finish_task 或自然 stop 主动提前结束）
      const parsedClientMaxSteps = Number(clientMaxSteps);
      const envMaxSteps = Number(process.env.LLM_MAX_STEPS);
      const envPlanMaxSteps = Number(process.env.LLM_PLAN_MAX_STEPS);
      const baseDefaultMaxSteps =
        Number.isFinite(envMaxSteps) && envMaxSteps > 0 ? envMaxSteps : 25;
      const defaultMaxSteps =
        mode === "plan"
          ? Number.isFinite(envPlanMaxSteps) && envPlanMaxSteps > 0
            ? envPlanMaxSteps
            : baseDefaultMaxSteps
          : baseDefaultMaxSteps;
      const rawMaxSteps =
        Number.isFinite(parsedClientMaxSteps) && parsedClientMaxSteps > 0
          ? parsedClientMaxSteps
          : defaultMaxSteps;
      const maxSteps = Math.min(Math.max(Math.round(rawMaxSteps), 1), 100);

      console.log("[Analyze API Request]", { model, baseURL, protocol: clientProtocol ?? "openai", mode, maxSteps, hasApiKey: !!apiKey });

      // 安全约束：客户端自带 baseURL 时必须同时自带 apiKey。
      // 否则服务端会拿着 env 中的真实 Key 去请求客户端指定的任意 URL —— 凭证外泄通道。
      if (clientBaseURL && !clientKey) {
        return Response.json(
          { error: "自定义 baseURL 时必须同时提供 apiKey（不允许与服务端环境凭证混用）" },
          { status: 400 }
        );
      }

      // 当未配置 Key 时，返回合规的 Data Stream 协议响应
      if (!apiKey) {
        const msg = `⚠️ 请先在右上角「设置」中配置您的 API Key。\n\n\`\`\`openui\nInsightBox(type="warning", title="未检测到 LLM API Key", content="请点击右上角「设置」进入「模型配置」输入 API Key，开启由 Vercel AI SDK 与多数据源 MCP（内置 + 动态配置）驱动的流式数据分析看板。")\n\`\`\``;
        const dataStreamChunk = `0:${JSON.stringify(msg)}\nd:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n`;

        return new Response(dataStreamChunk, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "x-vercel-ai-data-stream": "v1",
          },
        });
      }

      // 协议分派：anthropic 端点（如 Kimi Coding，实际路径 /v1/messages，baseURL 自动补 /v1）
      // 或缺省 openai 兼容端点（/chat/completions，baseURL 去尾斜杠）
      const normalizedBase = baseURL.replace(/\/+$/, "");
      const anthropicBase = /\/v1$/.test(normalizedBase)
        ? normalizedBase
        : `${normalizedBase}/v1`;
      const baseModel =
        clientProtocol === "anthropic"
          ? createAnthropic({ apiKey, baseURL: anthropicBase })(model)
          : createOpenAI({ apiKey, baseURL: normalizedBase, fetch: createReasoningFetch() })(model);

      // 提取 <think>...</think> 标签为标准 reasoning 分块（统一兼容 DeepSeek/Qwen 以及经由 createReasoningFetch 拦截转换的 GLM/Moonshot 等）
      const languageModel =
        baseModel && typeof baseModel === "object"
          ? wrapLanguageModel({
              model: baseModel,
              middleware: extractReasoningMiddleware({ tagName: "think" }),
            })
          : baseModel;

      // 会话级数据源：请求 id ∩ 全局启用 ∩ 实际存在；未知 id 忽略并告警
      const activeSources = datasources.resolveActive(
        Array.isArray(clientSources) ? (clientSources as string[]) : undefined
      );

      // 按激活源装配工具（http-mcp / db / stdio-cli）；
      // 单一数据源失败时降级为空工具集而非拖垮整个请求
      const toolEntries: { id: string; tools: Promise<Record<string, CoreTool>> }[] =
        [];
      for (const s of activeSources) {
        const conf = datasources.get(s.id);
        if (!conf) continue;
        toolEntries.push({ id: s.id, tools: datasources.tools(conf).then(toAiTools) });
      }

      const settledResults = await Promise.allSettled(
        toolEntries.map((e) => e.tools)
      );
      const loadedTools: Record<string, CoreTool> = {};
      settledResults.forEach((r, i) => {
        if (r.status === "rejected") {
          console.warn(
            `[Analyze API] ${toolEntries[i].id} 工具加载失败，降级为空工具集:`,
            r.reason
          );
          return;
        }
        mergeToolSets(loadedTools, r.value, toolEntries[i].id);
      });

      // prompt 数据源清单：动态源写入实际装载到的工具名
      const summaries: ActiveSourceSummary[] = activeSources.map((s) => {
        const idx = toolEntries.findIndex((e) => e.id === s.id);
        const settled = idx >= 0 ? settledResults[idx] : undefined;
        return settled?.status === "fulfilled"
          ? { ...s, tools: Object.keys(settled.value) }
          : s;
      });

      // 按阶段分派系统提示词：plan → 规划变体（探查边界 + PlanReviewCard 契约 + 选法指令）；
      // execute → base + 按已确认思路执行的增量约束 + 命中方法卡详情（按需注入）；
      // direct → base 直出看板 + 方法索引（常驻）
      const userQueryHint = extractLatestUserQuery(messages);
      const schemaDigest = await buildSchemaDigest(datasources, summaries, userQueryHint);
      const methodDetails =
        mode === "execute"
          ? buildMethodDetailsFromMessages(methodLibrary, messages)
          : undefined;
      const baseSystem =
        mode === "plan"
          ? getOpenUIPlanPrompt(summaries, schemaDigest, methodIndexText)
          : mode === "execute"
            ? getExecuteSystemPrompt(summaries, schemaDigest, methodDetails)
            : getOpenUISystemPrompt(summaries, schemaDigest, methodIndexText);

      // ========== 上下文治理（投影式压缩，设计见 context.ts） ==========
      // 会话元数据读取失败静默降级（仅当次启发式，不阻塞分析）
      const sessionCtx =
        sessions && typeof clientSessionId === "string" && clientSessionId
          ? await sessions.getContext(clientSessionId).catch(() => undefined)
          : undefined;
      const contextWindow = resolveContextWindow(model, clientContextWindow);
      const budget = computeBudget(contextWindow, maxOutputTokens);
      const projection = projectMessages({
        messages: messages as CoreMessage[],
        budget,
        anchorTokens: sessionCtx?.lastPromptTokens,
        systemTokens: estimateTextTokens(baseSystem),
      });

      let system = baseSystem;
      let projectedMessages = projection.messages;
      if (projection.summarizeUpToIndex >= 0) {
        const covered = projection.messages.slice(
          0,
          projection.summarizeUpToIndex + 1
        );
        const lastCovered = covered[covered.length - 1] as
          | { id?: unknown }
          | undefined;
        // 游标优先用消息 id；CoreMessage 无 id 时退化为下标标记（单调递增语义）
        const marker =
          typeof lastCovered?.id === "string"
            ? (lastCovered.id as string)
            : `index:${projection.summarizeUpToIndex}`;
        let summary =
          sessionCtx?.summaryUptoMessageId === marker
            ? sessionCtx.summary
            : undefined;
        if (!summary) {
          try {
            const generated = await generateText({
              model: languageModel,
              maxTokens: SUMMARY_MAX_TOKENS,
              temperature: 0,
              messages: [
                {
                  role: "user",
                  content: buildSummaryPrompt({
                    covered,
                    previousSummary: sessionCtx?.summary,
                  }),
                },
              ],
            });
            summary = generated.text.trim();
            if (summary && sessions && typeof clientSessionId === "string") {
              await sessions
                .updateContext(clientSessionId, {
                  summary,
                  summaryUptoMessageId: marker,
                })
                .catch(() => {});
            }
          } catch (err) {
            // 摘要失败不阻塞分析：退化为 pruning 投影（模型端溢出由压缩恢复语义兜底）
            console.warn("[上下文治理] 摘要生成失败，退化为 pruning 投影:", err);
          }
        }
        if (summary) {
          system = `${baseSystem}\n\n## 此前会话摘要\n${summary}`;
          projectedMessages = trimAfterSummaryCut(
            projection.messages.slice(projection.summarizeUpToIndex + 1)
          );
        }
      }
      if (projection.pruned || projection.summarizeUpToIndex >= 0) {
        console.log("[上下文治理]", {
          estimated: projection.estimatedPromptTokens,
          triggerAt: budget.triggerAt,
          pruned: projection.prunedCount,
          summarized: projection.summarizeUpToIndex >= 0,
          before: (messages as CoreMessage[]).length,
          after: projectedMessages.length,
        });
      }

      // 跨源映射工具：仅当用户在 cross-source-map.json 配置的源配对
      // 在当前激活源集合中成立时注册（代码不内置任何数据源名）
      const crossSourceTools: Record<string, CoreTool> = {};
      const crossSourcePairs = resolveCrossSourcePairs(summaries.map((s) => s.id));
      if (crossSourcePairs.length > 0) {
        const pairDesc = crossSourcePairs
          .map((p) => `${p.projectSource} ↔ ${p.repoSource}`)
          .join(", ");
        crossSourceTools.cross_source_link = tool({
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
            console.log("[Vercel AI SDK -> CrossSource] cross_source_link:", project_id);
            return getCrossSourceLinks(project_id);
          },
        });
      }

      // 使用现代 createDataStreamResponse 管理流生命周期，避免旧 StreamData 15秒悬挂超时警告与异常中止泄漏
      const rawResponse = createDataStreamResponse({
        execute: (dataStream) => {
          // 跟踪最后一步的单步输入 promptTokens（反映对话历史的真实单次窗口占用峰值）
          let lastStepPromptTokens: number | undefined;
          let lastStepFinishReason: string | undefined;
          let explicitFinishDetails: { status: string; summary?: string } | undefined;

          // 双重终态机制：显式终态工具 finish_task
          const finishTaskTool = tool({
            description:
              "显式宣告分析/规划任务已达成终态并闭环。当数据获取完毕、分析结论和可视化看板或规划卡已就绪时调用。调用此工具表示本轮取数全部结束，无需再发起其他数据查询。",
            parameters: jsonSchema<{
              status: "completed" | "insufficient_data" | "blocked";
              summary?: string;
            }>({
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["completed", "insufficient_data", "blocked"],
                  description:
                    "任务终态状态：completed（分析完成并已输出结论/看板）、insufficient_data（必要数据缺失或查询无果）、blocked（遇到阻塞错误）",
                },
                summary: {
                  type: "string",
                  description: "分析结果或终态说明的一句话简要总结",
                },
              },
              required: ["status"],
            }),
            execute: async ({ status, summary }) => {
              explicitFinishDetails = { status, summary };
              console.log(
                `[Dual-Termination] Explicit finish_task invoked: status=${status}, summary=${summary || ""}`
              );
              dataStream.writeData({
                type: "task_finish",
                termination: "explicit",
                status,
                summary: summary ?? "",
              });
              return {
                terminated: true,
                status,
                summary: summary ?? "",
                message: "分析任务终态已确认。请输出最终分析结果与看板（若已输出则直接结束）。",
              };
            },
          });

          const result = streamText({
            model: languageModel,
            system,
            // 投影后的消息（存储层历史不动；无治理需求时与入参一致）
            messages: projectedMessages,
            temperature,
            // AI SDK v1 参数名为 maxTokens（透传 max_tokens；Anthropic 端点必填）
            maxTokens: maxOutputTokens,
            tools: {
              ...loadedTools,
              ...crossSourceTools,
              finish_task: finishTaskTool,
            },
            maxSteps,
            onStepFinish({ stepType, toolCalls, text, finishReason, usage }) {
              lastStepFinishReason = finishReason;
              console.log(
                `[Vercel AI SDK Step Finish] type=${stepType}, finishReason=${finishReason}, toolCalls=${toolCalls?.length || 0}, textLength=${text?.length || 0}`
              );
              if (usage && typeof usage.promptTokens === "number" && Number.isFinite(usage.promptTokens)) {
                lastStepPromptTokens = usage.promptTokens;
                // 单步完成后即时向下发送最新单步 token 用量（实时平滑刷新）
                dataStream.writeData({
                  type: "context_usage",
                  promptTokens: usage.promptTokens,
                });
              }
            },
            // token 锚点回写与流式用量下发：
            // 关键修复：必须使用最后一步实际发往 LLM 的单步 promptTokens，不能使用 AI SDK 多步工具调用的累加值
            onFinish({ usage }) {
              const actualPromptTokens = lastStepPromptTokens ?? usage?.promptTokens;
              if (typeof actualPromptTokens === "number" && Number.isFinite(actualPromptTokens)) {
                dataStream.writeData({
                  type: "context_usage",
                  promptTokens: actualPromptTokens,
                });
              }

              // 双重终态判定：若未被显式 finish_task 捕获，则评估自然停止与截断兜底
              if (!explicitFinishDetails) {
                if (lastStepFinishReason === "stop" || lastStepFinishReason === undefined) {
                  console.log("[Dual-Termination] Concluded via natural termination (finishReason=stop)");
                  dataStream.writeData({
                    type: "task_finish",
                    termination: "natural",
                    status: "completed",
                  });
                } else if (lastStepFinishReason === "length") {
                  console.warn("[Dual-Termination] Concluded via step limit / token length truncation");
                  dataStream.writeData({
                    type: "task_finish",
                    termination: "step_limit_reached",
                    status: "truncated",
                  });
                } else {
                  console.log(`[Dual-Termination] Concluded with finishReason=${lastStepFinishReason}`);
                  dataStream.writeData({
                    type: "task_finish",
                    termination: lastStepFinishReason,
                    status: "completed",
                  });
                }
              }

              if (
                sessions &&
                typeof clientSessionId === "string" &&
                clientSessionId &&
                actualPromptTokens
              ) {
                void sessions
                  .updateContext(clientSessionId, {
                    lastPromptTokens: actualPromptTokens,
                  })
                  .catch(() => {});
              }
            },
          });

          result.mergeIntoDataStream(dataStream, { sendReasoning: true });
        },
        onError: (err: unknown) => {
          console.error("[AI SDK Stream Error]:", err);
          return err instanceof Error ? err.message : String(err);
        },
      });

      if (clientSessionId) {
        return streamHub.registerAndConsume(clientSessionId, rawResponse);
      }
      return rawResponse;
    } catch (err: unknown) {
      console.error("Vercel AI SDK Route error in handler:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      return new Response(
        `3:${JSON.stringify(errorMessage)}\n`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "x-vercel-ai-data-stream": "v1",
          },
        }
      );
    }
  };

  POST.isSessionRunning = (sessionId: string) => streamHub.hasRunningTask(sessionId);
  POST.abortSession = (sessionId: string) => streamHub.abortTask(sessionId);
  POST.streamHub = streamHub;

  return POST;
}
