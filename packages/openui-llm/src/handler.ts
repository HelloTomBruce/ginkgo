import path from "node:path";
import {
  streamText,
  generateText,
  tool,
  jsonSchema,
  createDataStreamResponse,
  type CoreMessage,
  type CoreTool,
  type LanguageModel,
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
import {
  mergeToolSets,
  renderCardForPrompt,
  CertifiedQueryStore,
  matchCertifiedQueries,
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
import { getOpenUISystemPrompt, getOpenUIPlanPrompt, getExecuteSystemPrompt } from "./prompt";
import { instrumentTools } from "./pipeline/instrumentTools";
import {
  buildMethodDetailsFromMessages,
  renderMethodDetailsByIds,
} from "./pipeline/methodSelector";
import { extractPlanMethods } from "./pipeline/planExtractor";

export { buildMethodDetailsFromMessages, extractPlanMethods };
import {
  defaultCrossSourceRegistry,
  CrossSourceRegistry,
} from "./crossSourceMap";
import {
  defaultModelCatalog,
  type ModelCatalog,
  DEFAULT_TENANT_ID,
  SessionStreamHub,
  defaultStreamHub,
  FileTaskStore,
  RedisTaskStore,
  type TaskStore,
  classifyProviderError,
  isRetriableErrorClass,
  resolveResiliencePolicy,
  type ResiliencePolicy,
  type ResolvedModelSpec,
  buildLanguageModel as createConfiguredModel,
  type TelemetrySink,
  computeCostUsd,
  DEFAULT_QUOTA_WINDOW_MS,
  InMemoryCostLedger,
  ModelPricingTable,
  type CostLedger,
  type QuotaPolicy,
  createConsoleSink,
  newRunId,
} from "@openui-analytics/harness-core";

/** 全部启用源结构卡注入 prompt 的总量预算（与单卡 2KB 预算配套，快照测试守护） */
export const SCHEMA_DIGEST_TOTAL_BUDGET_BYTES = 8 * 1024;

/**
 * env → TaskStore（显式注入 opts.taskStore 时本函数不被调用——注入优先于 env，
 * 非法 env 值不影响注入方）。redis 模式为多副本后端，要求 REDIS_URL。
 */
function resolveTaskStoreFromEnv(): TaskStore | undefined {
  const storeKind = process.env.LLM_TASK_STORE ?? "memory";
  if (storeKind === "memory") return undefined;
  if (storeKind === "file") {
    return new FileTaskStore({ dir: process.env.LLM_TASK_STORE_DIR ?? "data/stream-tasks" });
  }
  if (storeKind === "redis") {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        "LLM_TASK_STORE=redis 需要 REDIS_URL（如 redis://localhost:6379）；单进程部署请改用 memory 或 file。"
      );
    }
    return new RedisTaskStore({ url });
  }
  throw new Error(`不支持的 LLM_TASK_STORE=${storeKind}（可选 memory/file/redis）`);
}

/** 读正整数 env（缺省/非法返回 undefined，由选项缺省值接管） */
function envPositiveNumber(name: string): number | undefined {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * WS-12 请求级 tokenizer 解析：注入优先；env LLM_TOKENIZER=tiktoken 时
 * 按 config/model-tokenizer.json 映射动态加载（每请求解析 encoding，
 * 实例在 tokenizer.ts 内按 encoding 缓存）。未安装/未启用回退启发式。
 */
async function resolveRequestTokenizer(
  injected: { encode(text: string): number } | undefined,
  model: string
): Promise<{ encode(text: string): number } | undefined> {
  if (injected) return injected;
  if (process.env.LLM_TOKENIZER !== "tiktoken") return undefined;
  const { createTiktokenEstimator, resolveEncodingForModel } = await import("./tokenizer");
  return createTiktokenEstimator(resolveEncodingForModel(model));
}

/**
 * 组装启用源的结构卡摘要：逐源读卡（渲染职责在 datasources 包），
 * 依据用户提问相关度优先展开核心表，按总量预算降序纳入，超限的源省略并标注。
 * 读卡失败静默跳过（不阻塞分析）。返回摘要文本与因预算被省略的源数（供遥测告警）。
 */
async function buildSchemaDigest(
  datasources: DatasourceManager,
  activeSources: ActiveSourceSummary[],
  queryHint?: string
): Promise<{ text?: string; omitted: number }> {
  if (activeSources.length === 0) return { omitted: 0 };
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
  if (sections.length === 0) return { omitted };
  if (omitted > 0) {
    sections.push(`（另有 ${omitted} 个数据源的结构卡因总量预算省略，可用工具现场探查）`);
  }
  return { text: sections.join("\n\n"), omitted };
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

/** 组合多个 abort signal:任一触发即触发(Node 原生 AbortSignal.any 的类型安全替代) */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const combined = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      combined.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => combined.abort(s.reason), { once: true });
  }
  return combined.signal;
}

/** 会话上下文元数据（投影式压缩的锚点与摘要缓存；与应用层 SessionContextMeta 同构） */
export interface SessionContextMeta {
  lastPromptTokens?: number;
  summary?: string;
  summaryUptoMessageId?: string;
  /**
   * WS-4 结构化规划工件:plan 阶段服务端从 PlanReviewCard.methods 提取后写入,
   * execute 阶段消费(按 id 注入方法卡详情)后置空数组,防陈旧规划被复用。
   */
  pendingPlan?: { methodIds: string[] };
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

/**
 * WS-10 鉴权上下文：authenticate 钩子的返回类型。
 * principal 必填（API key id / user id），tenantId 缺省以 principal 作为租户命名空间。
 */
export interface AuthContext {
  /** 调用方标识（API key id / user id），必填 */
  principal: string;
  /** 租户隔离命名空间；缺省 = principal */
  /** 租户隔离命名空间；缺省 = principal。契约：不得含冒号（':' 是存储键分隔符）。 */
  tenantId?: string;
  /** 供配额/审计透传的自定义声明（如 allowEnvCredentials） */
  claims?: Record<string, unknown>;
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
  /** 共享任务存储（可选注入；仅在未注入 streamHub 时生效，优先于 env） */
  taskStore?: TaskStore;
  /** owner 实例标识（可选注入；缺省 hostname:pid） */
  instanceId?: string;
  /** 认证口径知识库（可选注入；缺省尝试读取 config/certified-queries.json） */
  certifiedStore?: CertifiedQueryStore;
  /**
   * 鉴权钩子（WS-10，可选注入）：返回 null/undefined 即 401。
   * 不注入时保持现状（包不鉴权）——所有请求视为同一匿名租户 "anon"，
   * 行为与今天完全一致。
   */
  authenticate?: (req: Request) => Promise<AuthContext | null>;
  /**
   * 结构化遥测 sink（可选注入；缺省 NDJSON console）。
   * 注意：注入自建 SessionStreamHub 时需在 hub 构造函数传入同一 sink，
   * hub 内部事件（abort/reader error）才会汇入同一事件流。
   */
  telemetry?: TelemetrySink;
  /**
   * 成本台账（可选注入；缺省不启用——未注入且未配置配额时零行为变化）。
   * 多副本部署必须注入 RedisCostLedger：进程内实现等于每实例一份额度，语义错误。
   */
  costLedger?: CostLedger;
  /**
   * 租户配额策略（可选注入；缺省读 env LLM_TENANT_TOKEN_LIMIT，未配置则零拦截）。
   * 与 LLM_TASK_TOKEN_BUDGET 正交：一个管单次敞口、一个管租户累计。
   */
  quota?: QuotaPolicy;
  /** 模型计价表（可选注入；缺省读 config/model-pricing.json，缺表只记量不记钱） */
  pricing?: ModelPricingTable;
  /**
   * 真实 tokenizer（可选注入，WS-12）：只影响投影预判定；usage.promptTokens
   * 实测锚点仍是最高优先级。缺省 CJK 启发式，行为不变；env LLM_TOKENIZER=tiktoken
   * 时按 config/model-tokenizer.json 映射动态加载 js-tiktoken（未安装回退启发式）。
   */
  tokenizer?: { encode(text: string): number };
  /** 跨源联合映射注册表（可选注入；缺省全局单例 defaultCrossSourceRegistry） */
  crossSourceRegistry?: CrossSourceRegistry;
  /** 模型元数据注册表（可选注入；缺省全局单例 defaultModelCatalog） */
  modelCatalog?: ModelCatalog;
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
  /**
   * 任务累计 token 预算（prompt+completion 总和）：
   * 超限时立即写入 budget_exhausted 终态并中止 provider 生成，防成本敞口失控。
   * 缺省读 env LLM_TASK_TOKEN_BUDGET（缺省 600k），钳制 10k–5M。
   */
  budgetTokens?: number | string;
  /**
   * WS-9 韧性策略（可选注入）：maxRetries/backoffBaseMs/requestTimeoutMs/fallbacks。
   * 请求体优先于环境变量（LLM_MAX_RETRIES / LLM_REQUEST_TIMEOUT_MS / LLM_FALLBACK_MODELS）；
   * 缺省 maxRetries=2、requestTimeoutMs=60s、无 fallback（不切换模型）。
   */
  resilience?: ResiliencePolicy;
  /** 历史透传字段（如 gitlabUrl/gitlabToken）被忽略的现状保持 */
  [key: string]: unknown;
}

/**
 * LLM 编排门面：注入数据源单例，返回可直接作为 Next POST 路由的处理函数。
 * 逻辑与原 app/api/analyze/route.ts 逐行等价（仅依赖来源改为注入）。
 */
export function createAnalyzeHandler(opts: AnalyzeHandlerOptions) {
  const { datasources, sessions } = opts;
  // 注入替换缺省(需要 console+OTel 双写时由 app 侧传 compositeSink(consoleSink, otelSink))
  const telemetry = opts.telemetry ?? createConsoleSink();

  // env 解析集中在 handler 工厂；hub 只接收 TaskStore 接口，defaultStreamHub 永远保持内存缺省。
  // 显式注入 streamHub/taskStore 时跳过 env store 解析与校验（注入优先于 env）。
  const taskStore = opts.streamHub ? undefined : (opts.taskStore ?? resolveTaskStoreFromEnv());
  const streamHub =
    opts.streamHub ??
    (taskStore || opts.instanceId
      ? new SessionStreamHub({
          store: taskStore,
          instanceId: opts.instanceId,
          sink: telemetry,
          leaseTtlMs: envPositiveNumber("LLM_LEASE_TTL_MS"),
          sweepIntervalMs: envPositiveNumber("LLM_SWEEP_INTERVAL_MS"),
        })
      : defaultStreamHub);

  // 方法论库：注入或缺省内置；索引文本在工厂期渲染一次（库不变无需逐请求重算）
  const methodLibrary: MethodLibrary =
    opts.methodology ??
    createMethodLibrary({ builtin: builtinMethodCards }).library;
  const methodIndexText = renderMethodIndex(methodLibrary.cards);

  const certifiedStore =
    opts.certifiedStore ??
    new CertifiedQueryStore({
      configPath: path.join(process.cwd(), "config/certified-queries.json"),
    });

  // WS-3 进程级并发准入上限:同时 running 的会话任务数超限即拒绝新任务(reconnect 不占名额)
  const envConcurrent = Number(process.env.LLM_MAX_CONCURRENT_TASKS);
  const maxConcurrentTasks = Math.min(
    Math.max(Number.isFinite(envConcurrent) && envConcurrent > 0 ? envConcurrent : 8, 1),
    64
  );

  // WS-11 成本台账与配额：env 兜底（注入优先）。未配置配额且未注入台账时不建台账，
  // 记账与准入零行为变化；配置了配额但未注入台账则缺省内存台账（多副本部署必须
  // 显式注入 RedisCostLedger，进程内额度跨实例不可见——见 docs/llm-harness-multi-instance.md）。
  const envTenantTokenLimit = Number(process.env.LLM_TENANT_TOKEN_LIMIT);
  const quota =
    opts.quota ??
    (Number.isFinite(envTenantTokenLimit) && envTenantTokenLimit > 0
      ? {
          tenantTokenLimit: envTenantTokenLimit,
          windowMs: envPositiveNumber("LLM_QUOTA_WINDOW_MS") ?? DEFAULT_QUOTA_WINDOW_MS,
        }
      : undefined);
  const costLedger = opts.costLedger ?? (quota ? new InMemoryCostLedger() : undefined);
  const pricingTable = opts.pricing ?? new ModelPricingTable();
  const crossSourceRegistry = opts.crossSourceRegistry ?? defaultCrossSourceRegistry;
  const modelCatalog = opts.modelCatalog ?? defaultModelCatalog;

  const POST = async function (req: Request) {
    const runId = newRunId();
    try {
      // WS-10 鉴权接缝：注入 authenticate 时先行鉴权（null/undefined → 401）；
      // 未注入时所有请求视为匿名租户 "anon"，行为与今天完全一致。
      // 租户解析唯一入口：下游所有 hub 调用只透传 tenantId，不各自拼 sessionKey。
      const auth = opts.authenticate ? await opts.authenticate(req) : null;
      if (opts.authenticate && !auth) {
        telemetry.emit({
          type: "warn",
          runId,
          code: "AUTH_REJECTED",
          detail: "authenticate 返回 null，拒绝请求",
        });
        return Response.json({ error: "未授权" }, { status: 401 });
      }
      const tenantId = auth ? (auth.tenantId ?? auth.principal) : DEFAULT_TENANT_ID;

      const rawBody = (await req.json()) as AnalyzeRequestBody;
      if (rawBody && typeof rawBody === "object" && rawBody.action === "stop") {
        const sid = rawBody.sessionId;
        if (sid) {
          // 跨租户防护：只命中同租户的任务，他人 sessionId 按无任务处理
          await streamHub.abortTask(sid, "user", tenantId);
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
        budgetTokens: clientBudgetTokens,
      } = rawBody;

      // 遥测用的会话 id(缺省 undefined,贯穿全事件)
      const sessionIdForEvents =
        typeof clientSessionId === "string" && clientSessionId ? clientSessionId : undefined;

      // 检查是否为流重连请求（如页面刷新后客户端发起无缝续接）：
      // 若带有 reconnect 标记且服务端保留有该会话在途或刚完成的流任务，直接返回重连流
      const isReconnect = Boolean(rawBody && typeof rawBody === "object" && rawBody.reconnect);
      // 并发准入:仅约束「新任务」;重连是接入既有任务不占名额;无 sessionId 的请求不经 hub
      // 追踪,无法可靠计数(应用层如需全局限流在 Next middleware 侧做)
      if (
        !isReconnect &&
        clientSessionId &&
        (await streamHub.runningCount()) >= maxConcurrentTasks
      ) {
        telemetry.emit({
          type: "warn",
          runId,
          sessionId: sessionIdForEvents,
          code: "CONCURRENCY_REJECTED",
          detail: `running 任务数已达上限 ${maxConcurrentTasks},拒绝新任务`,
        });
        return Response.json(
          { error: "服务端分析任务并发已达上限，请稍后重试" },
          { status: 429 }
        );
      }
      // WS-11 租户配额准入：仅约束新任务（重连是接入既有任务，不产生新的模型开销）。
      // 滚动窗累计 >= 上限即 429；与并发准入同位递（仅新任务计数）。
      if (quota?.tenantTokenLimit && !isReconnect) {
        const windowUsage = await costLedger!.sumUsage(
          tenantId,
          quota.windowMs ?? DEFAULT_QUOTA_WINDOW_MS
        );
        if (windowUsage.tokens >= quota.tenantTokenLimit) {
          telemetry.emit({
            type: "warn",
            runId,
            sessionId: sessionIdForEvents,
            code: "QUOTA_EXCEEDED",
            detail: `租户 ${tenantId} 滚动窗累计 ${windowUsage.tokens} tokens 已达上限 ${quota.tenantTokenLimit},拒绝新任务`,
          });
          return Response.json(
            { error: "租户额度已用尽，请稍后重试" },
            { status: 429 }
          );
        }
      }
      if (
        clientSessionId &&
        isReconnect &&
        (await streamHub.hasTask(clientSessionId, tenantId))
      ) {
        const task = await streamHub.getTask(clientSessionId, tenantId);
        telemetry.emit({
          type: "reconnect",
          runId,
          sessionId: clientSessionId,
          replayedChunks: task?.chunks.length ?? 0,
        });
        // 跨租户防护：只接入同租户的任务
        const reconnResp = await streamHub.createResponse(clientSessionId, tenantId);
        if (reconnResp) return reconnResp;
      }

      // WS-10 多租户凭证隔离：claims.allowEnvCredentials === false 时跳过 env 凭证回退
      // （多租户 SaaS 形态下环境凭证属于平台，不被租户借用）
      const allowEnvCredentials = auth?.claims?.allowEnvCredentials !== false;
      const apiKey =
        clientKey ||
        (allowEnvCredentials ? process.env.OPENAI_API_KEY || process.env.LLM_API_KEY : undefined);
      const baseURL =
        clientBaseURL ||
        (allowEnvCredentials ? process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL : undefined) ||
        "https://api.openai.com/v1";
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

      // WS-3 任务累计 token 预算(prompt+completion 总和):超限即终态+中止,防成本敞口失控
      const envTokenBudget = Number(process.env.LLM_TASK_TOKEN_BUDGET);
      const parsedTokenBudget = Number(clientBudgetTokens);
      const rawTokenBudget =
        Number.isFinite(parsedTokenBudget) && clientBudgetTokens !== undefined && clientBudgetTokens !== ""
          ? parsedTokenBudget
          : Number.isFinite(envTokenBudget) && envTokenBudget > 0
            ? envTokenBudget
            : 600_000;
      const taskTokenBudget = Math.min(Math.max(Math.round(rawTokenBudget), 10_000), 5_000_000);

      // 安全约束：客户端自带 baseURL 时必须同时自带 apiKey。
      // 否则服务端会拿着 env 中的真实 Key 去请求客户端指定的任意 URL —— 凭证外泄通道。
      if (clientBaseURL && !clientKey) {
        telemetry.emit({
          type: "warn",
          runId,
          sessionId: sessionIdForEvents,
          code: "CRED_GUARD_REJECTED",
          detail: "自定义 baseURL 时未提供 apiKey，拒绝以环境凭证请求任意 URL",
        });
        return Response.json(
          { error: "自定义 baseURL 时必须同时提供 apiKey（不允许与服务端环境凭证混用）" },
          { status: 400 }
        );
      }

      // 当未配置 Key 时，返回合规的 Data Stream 协议响应
      if (!apiKey) {
        telemetry.emit({
          type: "warn",
          runId,
          sessionId: sessionIdForEvents,
          code: "NO_API_KEY",
          detail: "请求缺apiKey且服务端无环境凭证，返回设置引导降级流",
        });
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

      // WS-9 韧性策略解析：请求体 resilience ＞ 环境变量（LLM_MAX_RETRIES /
      // LLM_REQUEST_TIMEOUT_MS / LLM_FALLBACK_MODELS）＞ 缺省
      const resiliencePolicy = resolveResiliencePolicy(rawBody.resilience);

      // 凭证护栏（沿用 CRED_GUARD 原则）：fallback 指向新 baseURL 时必须自带 apiKey，
      // 不允许把主请求（可能是环境）凭证带到请求体未授权的 URL
      const normalizedPrimaryBase = baseURL.replace(/\/+$/, "");
      for (const fb of resiliencePolicy.fallbacks) {
        const effectiveBase = (fb.baseURL ?? baseURL).replace(/\/+$/, "");
        if (effectiveBase !== normalizedPrimaryBase && !fb.apiKey) {
          telemetry.emit({
            type: "warn",
            runId,
            sessionId: sessionIdForEvents,
            code: "CRED_GUARD_REJECTED",
            detail: `fallback 模型 ${fb.model} 指向新 baseURL 但未提供 apiKey，拒绝以主请求凭证请求`,
          });
          return Response.json(
            { error: "fallback 模型指向新 baseURL 时必须自带 apiKey（不允许与服务端环境凭证混用）" },
            { status: 400 }
          );
        }
      }

      // WS-9 模型链：主模型在前，fallback ModelSpec 按序随后
      // （缺省无 fallback 时单元素链，语义与现状一致）
      const primaryProtocol = clientProtocol === "anthropic" ? "anthropic" : "openai";
      const modelChain: ResolvedModelSpec[] = [
        { model, apiKey, baseURL, protocol: primaryProtocol },
        ...resiliencePolicy.fallbacks.map((fb) => ({
          model: fb.model,
          apiKey: fb.apiKey ?? apiKey,
          baseURL: fb.baseURL ?? baseURL,
          protocol: fb.protocol ?? primaryProtocol,
        })),
      ];

      // run_start:守卫(凭证/Key)全部通过,分析真正开始
      telemetry.emit({
        type: "run_start",
        runId,
        sessionId: sessionIdForEvents,
        mode,
        model,
        maxSteps,
        // 注入 authenticate 时透传鉴权上下文（未注入时字段缺省，行为与现状一致）
        ...(auth ? { principal: auth.principal, tenantId } : {}),
      });

      /**
       * 按模型链上的某个 ModelSpec 装配 languageModel（委托 providers/factory 装配）
       */
      const buildLanguageModel = (spec: ResolvedModelSpec): LanguageModel => {
        return createConfiguredModel(spec, {
          resiliencePolicy,
          telemetryHooks: {
            onRetry: (info) => {
              telemetry.emit({
                type: "warn",
                runId,
                sessionId: sessionIdForEvents,
                code: "PROVIDER_RETRY",
                detail: `第 ${info.attempt} 次重试(${info.errorClass})，等待 ${info.delayMs}ms：${info.reason}`,
              });
            },
            onCircuitBreak: (info) => {
              telemetry.emit({
                type: "warn",
                runId,
                sessionId: sessionIdForEvents,
                code: "REPETITION_CIRCUIT",
                detail: `输出重复循环已熔断:连续 ${info.repeats} 行相同,已产出 ${info.totalChars} 字符`,
              });
            },
          },
        });
      };

      const languageModel = buildLanguageModel(modelChain[0]);

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
        toolEntries.push({
          id: s.id,
          tools: datasources.tools(conf).then((bindings) => toAiTools(bindings, { sourceId: s.id })),
        });
      }

      const settledResults = await Promise.allSettled(
        toolEntries.map((e) => e.tools)
      );
      const loadedTools: Record<string, CoreTool> = {};
      settledResults.forEach((r, i) => {
        if (r.status === "rejected") {
          telemetry.emit({
            type: "warn",
            runId,
            sessionId: sessionIdForEvents,
            code: "TOOL_LOAD_FAILED",
            detail: `${toolEntries[i].id} 工具加载失败，降级为空工具集: ${
              r.reason instanceof Error ? r.reason.message : String(r.reason)
            }`,
          });
          return;
        }
        mergeToolSets(
          loadedTools,
          instrumentTools(r.value, {
            runId,
            sessionId: sessionIdForEvents,
            sourceId: toolEntries[i].id,
            telemetry,
          }),
          toolEntries[i].id
        );
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
      const activeSourceIds = summaries.map((s) => s.id);
      // 认证口径配置热加载：改 config/certified-queries.json 无需重启进程
      certifiedStore.reloadIfChanged();
      const certifiedMatches = userQueryHint
        ? matchCertifiedQueries(userQueryHint, activeSourceIds, certifiedStore)
        : [];

      const schemaDigest = await buildSchemaDigest(datasources, summaries, userQueryHint);
      if (schemaDigest.omitted > 0) {
        telemetry.emit({
          type: "warn",
          runId,
          sessionId: sessionIdForEvents,
          code: "SCHEMA_DIGEST_OMITTED",
          detail: `${schemaDigest.omitted} 个数据源结构卡因总量预算(${SCHEMA_DIGEST_TOTAL_BUDGET_BYTES}B)省略`,
        });
      }
      // 会话上下文元数据提前读取:execute 消费 pendingPlan(WS-4)与投影锚点共用;
      // 读取失败静默降级（仅当次启发式，不阻塞分析）
      const sessionCtx =
        sessions && typeof clientSessionId === "string" && clientSessionId
          ? await sessions.getContext(clientSessionId).catch(() => undefined)
          : undefined;
      let methodDetails: string | undefined;
      if (mode === "execute") {
        const pendingIds = sessionCtx?.pendingPlan?.methodIds ?? [];
        if (pendingIds.length > 0) {
          // WS-4 结构化主路径:plan 阶段登记的 methodIds 精确注入
          methodDetails = renderMethodDetailsByIds(methodLibrary, pendingIds);
          // 消费即清空(置空数组,增量合并语义可落盘),防陈旧规划被后续 execute 复用
          void sessions
            ?.updateContext(clientSessionId as string, {
              pendingPlan: { methodIds: [] },
            })
            .catch(() => {});
        } else {
          // 降级兜底:旧格式规划(卡片无 methods 参数)走散文匹配
          methodDetails = buildMethodDetailsFromMessages(methodLibrary, messages);
          if (methodDetails) {
            telemetry.emit({
              type: "warn",
              runId,
              sessionId: sessionIdForEvents,
              code: "PLAN_FALLBACK_LEGACY",
              detail: "pendingPlan 缺失,execute 回退到散文匹配提取方法",
            });
          }
        }
      }
      const baseSystem =
        mode === "plan"
          ? getOpenUIPlanPrompt(summaries, schemaDigest.text, methodIndexText, certifiedMatches)
          : mode === "execute"
            ? getExecuteSystemPrompt(summaries, schemaDigest.text, methodDetails, certifiedMatches)
            : getOpenUISystemPrompt(summaries, schemaDigest.text, methodIndexText, certifiedMatches);

      // ========== 上下文治理（投影式压缩，设计见 context.ts） ==========
      // sessionCtx 已在上方提前读取(execute 消费 pendingPlan 与此处投影共用)
      /**
       * 按当前模型解析上下文窗口并重算投影预算。WS-9 控制者裁决：客户端 contextWindow
       * hint 仅对主模型生效；fallback 模型只用查表值（hint 传 undefined），
       * 切换时在模型链循环内对本模型重解析并重算投影。
       */
      const projectForModel = async (
        modelName: string,
        hint: unknown,
        summaryModel: LanguageModel
      ): Promise<{ system: string; messages: CoreMessage[] }> => {
        const contextWindow = resolveContextWindow(modelName, hint, modelCatalog);
        const budget = computeBudget(contextWindow, maxOutputTokens);
        const projection = projectMessages({
          messages: messages as CoreMessage[],
          budget,
          anchorTokens: sessionCtx?.lastPromptTokens,
          systemTokens: estimateTextTokens(baseSystem),
          tokenizer: await resolveRequestTokenizer(opts.tokenizer, model),
        });

        let systemOut = baseSystem;
        let messagesOut = projection.messages;
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
                model: summaryModel,
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
              telemetry.emit({
                type: "warn",
                runId,
                sessionId: sessionIdForEvents,
                code: "SUMMARY_FAILED",
                detail: err instanceof Error ? err.message : String(err),
              });
            }
          }
          if (summary) {
            systemOut = `${baseSystem}\n\n## 此前会话摘要\n${summary}`;
            messagesOut = trimAfterSummaryCut(
              projection.messages.slice(projection.summarizeUpToIndex + 1)
            );
          }
        }
        if (projection.pruned || projection.summarizeUpToIndex >= 0) {
          telemetry.emit({
            type: "context_projection",
            runId,
            sessionId: sessionIdForEvents,
            estimated: projection.estimatedPromptTokens,
            triggerAt: budget.triggerAt,
            pruned: projection.prunedCount,
            summarized: projection.summarizeUpToIndex >= 0,
          });
        }
        return { system: systemOut, messages: messagesOut };
      };

      const primaryProjection = await projectForModel(
        model,
        clientContextWindow,
        languageModel
      );
      const system = primaryProjection.system;
      const projectedMessages = primaryProjection.messages;

      // 跨源映射工具：仅当用户在 cross-source-map.json 配置的源配对
      // 在当前激活源集合中成立时注册（代码不内置任何数据源名）
      const crossSourceTools: Record<string, CoreTool> = {};
      const crossSourcePairs = crossSourceRegistry.resolveCrossSourcePairs(summaries.map((s) => s.id));
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
            telemetry.emit({
              type: "tool_result",
              runId,
              sessionId: sessionIdForEvents,
              tool: "cross_source_link",
              ok: true,
              bytes: -1,
              durationMs: 0,
            });
            return crossSourceRegistry.getCrossSourceLinks(project_id);
          },
        });
      }

      // 使用现代 createDataStreamResponse 管理流生命周期，避免旧 StreamData 15秒悬挂超时警告与异常中止泄漏
      const runStartTs = Date.now();
      let stepIndex = 0;
      let prevStepTs = runStartTs;
      let lastStepPromptTokens: number | undefined;
      let lastStepFinishReason: string | undefined;
      let explicitFinishDetails: { status: string; summary?: string } | undefined;
      /** 最后一步的模型文本(plan 模式 onFinish 据此提取 methods,WS-4) */
      let lastStepText: string | undefined;
      // WS-5 finish_task 不变量:跨步骤累计「已产出看板/规划卡」的证据
      let hasDashboardOutput = false;
      let hasPlanCardOutput = false;
      // 任务级中止控制器:abortTask(用户停止/看门狗超时)经 hub 触发后传导进
      // streamText 并以 error 语义终止订阅;预算熔断走独立 controller——只取消
      // provider 生成,流自然收尾(客户端已收到 task_finish,订阅不得 error)
      const taskAbortController = new AbortController();
      const budgetAbortController = new AbortController();
      // WS-3 累计 token 计量(prompt+completion 总和):超预算立即终态+中止
      let totalTokens = 0;
      let budgetExceeded = false;

      const rawResponse = createDataStreamResponse({
        execute: async (dataStream) => {
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
              // WS-5 服务端不变量:completed 必须有产出证据(看板代码块或规划卡),
              // 把提示词的「严禁无产出宣告完成」从软约束变成硬兜底
              if (
                status === "completed" &&
                !hasDashboardOutput &&
                !hasPlanCardOutput
              ) {
                telemetry.emit({
                  type: "warn",
                  runId,
                  sessionId: sessionIdForEvents,
                  code: "FINV_GATE_REJECTED",
                  detail: `finish_task(completed) 被拒:无看板/规划卡产出证据`,
                });
                return {
                  terminated: false,
                  status: "rejected",
                  summary: summary ?? "",
                  message:
                    "尚未输出分析报告与 ```openui 看板代码块（规划模式则为 PlanReviewCard），不能宣告 completed。请先完成正式输出；若确属数据缺失或遇到阻塞，请改用 status=insufficient_data 或 status=blocked。",
                };
              }
              explicitFinishDetails = { status, summary };
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
                message:
                  "数据取数与任务终态已确认闭环。若你在上一步或当前步骤已输出了完整的 Markdown 分析报告与 ```openui 看板代码块，严禁重复输出，直接输出一句简要闭环致辞即可自然结束；若尚未输出报告与看板，请在此处基于已获取的数据输出一份完整的 Markdown 深度分析报告及 ```openui ... ``` 可视化动态看板代码块。每轮回复严格只能有一份报告和一个看板，绝对不可重复输出两遍！",
              };
            },
          });

          // WS-9 模型链循环：主模型 fetch 层重试用尽后按序切换 fallback ModelSpec 重发整个
          // streamText。诚实重试边界——仅当未产出任何 content 分块才允许切换（客户端已见
          // 部分内容，重跑会重复输出）；此类失败发 MID_STREAM_FAILURE 遥测后按 onError 报错。
          let chainIndex = 0;
          let attemptSystem = system;
          let attemptMessages = projectedMessages;

          for (;;) {
            const spec = modelChain[chainIndex];
            let emittedContent = false;
            try {
              const result = streamText({
                // 主模型复用上方为摘要生成装配的 languageModel(同一 ModelSpec),
                // fallback 模型才现场装配
                model:
                  chainIndex === 0
                    ? languageModel
                    : buildLanguageModel(spec),
                system: attemptSystem,
                // 投影后的消息（存储层历史不动；无治理需求时与入参一致）
                messages: attemptMessages,
                temperature,
                // AI SDK v1 参数名为 maxTokens（透传 max_tokens；Anthropic 端点必填）
                maxTokens: maxOutputTokens,
                // 任务中止信号:任一来源(硬停止/预算熔断)取消 provider 生成
                abortSignal: anySignal([
                  taskAbortController.signal,
                  budgetAbortController.signal,
                ]),
                tools: {
                  ...loadedTools,
                  ...crossSourceTools,
                  finish_task: finishTaskTool,
                },
                maxSteps,
                // 韧性边界标记：text/reasoning/tool-call 任一分块落地即置位——
                // 这些分块都会写进客户端流（客户端可见即视为已产出）；tool-call 不置位
                // 的话，工具已执行后重发 streamText 会重复执行数据源查询（副作用）
                onChunk: ({ chunk }) => {
                  if (
                    chunk.type === "text-delta" ||
                    chunk.type === "reasoning" ||
                    chunk.type === "tool-call" ||
                    chunk.type === "tool-call-streaming-start" ||
                    chunk.type === "tool-call-delta" ||
                    chunk.type === "tool-result"
                  ) {
                    emittedContent = true;
                  }
                },
                onStepFinish({ text, toolCalls, finishReason, usage }) {
                  stepIndex++;
                  if (typeof text === "string" && text.length > 0) {
                    lastStepText = text;
                    // 不变量证据跨步骤累计(报告与看板可能分步输出)
                    if (text.includes("```openui")) hasDashboardOutput = true;
                    if (text.includes("PlanReviewCard")) hasPlanCardOutput = true;
                  }
                  lastStepFinishReason = finishReason;
                  const stepDurationMs = Date.now() - prevStepTs;
                  prevStepTs = Date.now();
                  telemetry.emit({
                    type: "step_finish",
                    runId,
                    sessionId: sessionIdForEvents,
                    step: stepIndex,
                    finishReason: finishReason ?? "unknown",
                    toolCalls: (toolCalls ?? []).map((c) => c.toolName),
                    promptTokens:
                      typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
                    durationMs: stepDurationMs,
                  });
                  if (usage && typeof usage.promptTokens === "number" && Number.isFinite(usage.promptTokens)) {
                    lastStepPromptTokens = usage.promptTokens;
                    // 单步完成后即时向下发送最新单步 token 用量（实时平滑刷新）
                    dataStream.writeData({
                      type: "context_usage",
                      promptTokens: usage.promptTokens,
                    });
                  }
                  // 累计预算熔断:超限写终态并中止 provider(客户端按既有 status=truncated 渲染)
                  if (usage) {
                    const p =
                      typeof usage.promptTokens === "number" && Number.isFinite(usage.promptTokens)
                        ? usage.promptTokens
                        : 0;
                    const c =
                      typeof usage.completionTokens === "number" && Number.isFinite(usage.completionTokens)
                        ? usage.completionTokens
                        : 0;
                    totalTokens += p + c;
                    if (!budgetExceeded && totalTokens > taskTokenBudget) {
                      budgetExceeded = true;
                      dataStream.writeData({
                        type: "task_finish",
                        termination: "budget_exhausted",
                        status: "truncated",
                      });
                      // 仅取消 provider(独立 controller),不触发 hub 的 error 语义——
                      // 流随后自然关闭,订阅者正常收到已写入的终态分块
                      budgetAbortController.abort();
                      telemetry.emit({
                        type: "warn",
                        runId,
                        sessionId: sessionIdForEvents,
                        code: "BUDGET_EXHAUSTED",
                        detail: `累计 ${totalTokens} tokens 超预算 ${taskTokenBudget},已中止任务`,
                      });
                    }
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

                  // 双重终态判定：若未被显式 finish_task 捕获，则评估预算熔断/自然停止/截断兜底
                  let termination: string;
                  let status: string;
                  if (!explicitFinishDetails) {
                    if (budgetExceeded) {
                      // 预算终态已在 onStepFinish 写入,此处仅对齐遥测口径,不重复下发
                      termination = "budget_exhausted";
                      status = "truncated";
                    } else if (lastStepFinishReason === "stop" || lastStepFinishReason === undefined) {
                      termination = "natural";
                      status = "completed";
                    } else if (lastStepFinishReason === "length") {
                      termination = "step_limit_reached";
                      status = "truncated";
                    } else {
                      termination = lastStepFinishReason ?? "unknown";
                      status = "completed";
                    }
                    if (!budgetExceeded) {
                      dataStream.writeData({
                        type: "task_finish",
                        termination,
                        status,
                      });
                    }
                  } else {
                    termination = "explicit";
                    status = explicitFinishDetails.status;
                  }
                  const runDurationMs = Date.now() - runStartTs;
                  telemetry.emit({
                    type: "task_finish",
                    runId,
                    sessionId: sessionIdForEvents,
                    termination,
                    status,
                    totalPromptTokens:
                      typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
                    totalCompletionTokens:
                      typeof usage?.completionTokens === "number" ? usage.completionTokens : undefined,
                    durationMs: runDurationMs,
                  });

                  // WS-11 成本计算与显式化下发（AI SDK 消息注解 + 流式数据双写）：
                  // 客户端可在消息底部显示耗时、tokens 以及精确美元消耗
                  const recordedPrompt =
                    typeof usage?.promptTokens === "number" ? usage.promptTokens : 0;
                  const recordedCompletion =
                    typeof usage?.completionTokens === "number" ? usage.completionTokens : 0;
                  const totalRecordedTokens = recordedPrompt + recordedCompletion;
                  const pricing = pricingTable?.priceFor(model);
                  const costUsd = pricing
                    ? computeCostUsd(pricing, recordedPrompt, recordedCompletion)
                    : undefined;

                  const finopsPayload = {
                    type: "finops_cost",
                    model,
                    promptTokens: recordedPrompt,
                    completionTokens: recordedCompletion,
                    totalTokens: totalRecordedTokens,
                    durationMs: runDurationMs,
                    ...(typeof costUsd === "number" ? { costUsd } : {}),
                  };
                  dataStream.writeData(finopsPayload);
                  dataStream.writeMessageAnnotation(finopsPayload);

                  // fire-and-forget，台账失败不阻塞主链路。
                  if (costLedger) {
                    void costLedger
                      .record({
                        runId,
                        tenantId,
                        sessionId: sessionIdForEvents,
                        model,
                        promptTokens: recordedPrompt,
                        completionTokens: recordedCompletion,
                        ...(costUsd !== undefined ? { costUsd } : {}),
                        finishedAt: Date.now(),
                      })
                      .catch(() => {});
                  }

                  // WS-4:plan 阶段从最终文本提取结构化 methods,登记为 pendingPlan
                  // (execute 轮消费后清空;提取失败静默——execute 侧有散文匹配兜底)
                  if (mode === "plan" && sessions && typeof clientSessionId === "string" && clientSessionId) {
                    const planIds = extractPlanMethods(lastStepText ?? "");
                    if (planIds.length > 0) {
                      void sessions
                        .updateContext(clientSessionId, { pendingPlan: { methodIds: planIds } })
                        .catch(() => {});
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

              // 消费「会抛错」的流：mergeIntoDataStream 在真实 SDK 下永不 reject——
              // 其内部 merge() 把 provider 失败吞成 data stream error part，fallback
              // 决策必须建立在真实抛错的迭代上。字节输出与 mergeIntoDataStream 等价
              // （同一 toDataStreamInternal 管线），错误则抛给下方 catch 做分类。
              const reader = result
                .toDataStream({ sendReasoning: true })
                .getReader();
              const decoder = new TextDecoder();
              // toDataStream 产出的是规范化 data stream 分块串（0:/2:/3:/d: 前缀）
              type DataStreamChunk = Parameters<typeof dataStream.write>[0];
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  dataStream.write(
                    decoder.decode(value, { stream: true }) as DataStreamChunk
                  );
                }
                const tail = decoder.decode();
                if (tail) dataStream.write(tail as DataStreamChunk);
              } finally {
                reader.releaseLock();
              }
              return;
            } catch (err) {
              // 用户停止/预算熔断触发的流错误走白名单：保持既有「流自然收尾 + onError
              // 路径」语义（错误分块 + STREAM_ERROR 遥测），不得 fallback 或误报
              // MID_STREAM_FAILURE
              if (
                taskAbortController.signal.aborted ||
                budgetAbortController.signal.aborted
              ) {
                throw err;
              }
              const errorClass = classifyProviderError(err);
              // 切换前提:未产出任何 content 分块,且链上还有 fallback,且错误类别允许
              // (context_overflow 不重试但可换更大窗模型;rate_limit/server/network 用尽重试后切换)
              const canSwitch =
                !emittedContent &&
                chainIndex < modelChain.length - 1 &&
                (errorClass === "context_overflow" ||
                  isRetriableErrorClass(errorClass));
              if (!canSwitch) {
                if (emittedContent) {
                  telemetry.emit({
                    type: "warn",
                    runId,
                    sessionId: sessionIdForEvents,
                    code: "MID_STREAM_FAILURE",
                    detail: `首分块后失败(${errorClass}),不做透明重跑: ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  });
                }
                throw err;
              }
              const next = modelChain[chainIndex + 1];
              telemetry.emit({
                type: "warn",
                runId,
                sessionId: sessionIdForEvents,
                code: "MODEL_FALLBACK",
                detail: `${spec.model} 失败(${errorClass}),切换 fallback 模型 ${next.model}`,
              });
              // 向客户端声明切换:客户端可据此解释后续输出的模型来源变化（流式下发 + 注解持久化）
              const fallbackPayload = {
                type: "model_fallback",
                from: spec.model,
                to: next.model,
                reason: errorClass,
              };
              dataStream.writeData(fallbackPayload);
              dataStream.writeMessageAnnotation(fallbackPayload);
              chainIndex++;
              // 控制者裁决:fallback 模型重解析上下文窗口(客户端 hint 仅主模型生效,
              // 这里传 undefined 只用查表值),并用重解析结果重算投影预算
              const nextProjection = await projectForModel(
                next.model,
                undefined,
                buildLanguageModel(next)
              );
              attemptSystem = nextProjection.system;
              attemptMessages = nextProjection.messages;
            }
          }
        },
        onError: (err: unknown) => {
          telemetry.emit({
            type: "error",
            runId,
            sessionId: sessionIdForEvents,
            code: "STREAM_ERROR",
            detail: err instanceof Error ? err.message : String(err),
          });
          return err instanceof Error ? err.message : String(err);
        },
      });

      if (clientSessionId) {
        return await streamHub.registerAndConsume(clientSessionId, rawResponse, {
          runId,
          abortController: taskAbortController,
          tenantId,
        });
      }
      return rawResponse;
    } catch (err: unknown) {
      telemetry.emit({
        type: "error",
        runId,
        code: "HANDLER_ERROR",
        detail: err instanceof Error ? err.message : String(err),
      });
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

  POST.isSessionRunning = (sessionId: string, tenantId?: string) =>
    streamHub.hasRunningTask(sessionId, tenantId);
  POST.abortSession = (sessionId: string, tenantId?: string) =>
    streamHub.abortTask(sessionId, "user", tenantId);
  POST.streamHub = streamHub;
  // WS-11 应用层出口：GET /api/usage 经此读取台账（未启用时为 undefined）
  POST.costLedger = costLedger;

  return POST;
}
