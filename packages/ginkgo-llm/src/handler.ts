import {
  streamText,
  generateText,
  createDataStreamResponse,
  InvalidToolArgumentsError,
  NoSuchToolError,
  type CoreMessage,
  type CoreTool,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import {
  computeBudget,
  estimateTextTokens,
  projectMessages,
  resolveContextWindow,
  trimAfterSummaryCut,
  buildGenericSummaryPrompt,
  SUMMARY_MAX_TOKENS,
} from "./context";
import type { AppDeliverableContract } from "@ginkgo/app-sdk";
import { toolFailure } from "@ginkgo/app-sdk";
import { withPlatformGuardrails, getPlatformBasePrompt } from "./platformPrompt";
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
  isReasoningModel,
  getCoreToolsFromMcp,
  createTerminationTool,
  composeToolInterceptors,
  createTelemetryInterceptor,
  type ToolInterceptor,
  zodTool,
  type RunId,
  type MCPClientManager,
  type MCPServerConfig,
} from "@ginkgo/harness-core";

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

/** 平台内核只读守卫切面：Plan 模式下拦截副作用写工具 */
function createReadonlyGuardInterceptor(mode?: string): ToolInterceptor {
  return async (args, ctx, next) => {
    if (mode === "plan") {
      const name = ctx.toolName.toLowerCase();
      const isWriteLike =
        name.startsWith("write_") ||
        name.startsWith("edit_") ||
        name.startsWith("delete_") ||
        name.startsWith("drop_") ||
        name.startsWith("init_") ||
        name.includes("_init") ||
        name === "bash" ||
        name === "run_command";

      if (isWriteLike) {
        return {
          isError: true,
          error: `【平台只读安全守卫拦截】当前处于 Plan 规划模式（只读），严禁执行修改或执行类工具 [${ctx.toolName}]。若任务需要写文件或执行命令，请调用 request_build_permission 工具向用户展示拟修改清单并申请切换至 Build 模式。`,
        };
      }
    }
    return next(args);
  };
}

/** 工具执行遥测切面与只读守卫包装 */
function instrumentTools(
  tools: Record<string, CoreTool>,
  ctx: {
    runId: RunId;
    sessionId?: string;
    sourceId?: string;
    telemetry: TelemetrySink;
    mode?: string;
  }
): Record<string, CoreTool> {
  const telemetryAspect = createTelemetryInterceptor(ctx);
  const readonlyAspect = createReadonlyGuardInterceptor(ctx.mode);
  // 稳健异常捕获切面：避免未捕获的工具异常导致整个流式生成崩溃
  const safeExecutionAspect: ToolInterceptor = async (args, toolCtx, next) => {
    try {
      return await next(args);
    } catch (err) {
      // 取消语义不可吞：用户中止/超时中断必须继续向上传播，由流式管道按取消处理
      if (err instanceof Error && err.name === "AbortError") throw err;
      const message = err instanceof Error ? err.message : String(err);
      return toolFailure(toolCtx.toolName, `执行出错: ${message}`);
    }
  };
  return composeToolInterceptors(tools, [telemetryAspect, readonlyAspect, safeExecutionAspect]);
}

/**
 * WS-12 请求级 tokenizer 解析：注入优先；env LLM_TOKENIZER=tiktoken 时
 * 按 config/model-tokenizer.json 映射动态加载（每请求解析 encoding，
 * 实例在 @ginkgo/harness-core 内按 encoding 缓存）。未安装/未启用回退启发式。
 */
async function resolveRequestTokenizer(
  injected: { encode(text: string): number } | undefined,
  model: string,
  configPath: string
): Promise<{ encode(text: string): number } | undefined> {
  if (injected) return injected;
  if (process.env.LLM_TOKENIZER !== "tiktoken") return undefined;
  const { createTiktokenEstimator, resolveEncodingForModel } = await import(
    "@ginkgo/harness-core"
  );
  const encoding = resolveEncodingForModel(model, configPath);
  return createTiktokenEstimator(encoding);
}

/** 提取对话历史中最后一条用户提问文本（语义召回/口径匹配提示） */
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

/** 合并工具集（同名冲突跳过并告警；语义与 datasources 包的 mergeToolSets 一致） */
function mergeToolSets(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  sourceId: string
): void {
  for (const [name, t] of Object.entries(incoming)) {
    if (name in target) {
      console.warn(`[llm] 工具名冲突，跳过 ${name}（来自 ${sourceId}）`);
      continue;
    }
    target[name] = t;
  }
}

/**
 * 解析 data stream 错误分块（`3:"..."`）的正文；非法 JSON 回退 SDK 缺省文案
 * （真实管线中正文由 toDataStream 的 getErrorMessage 还原为原始错误消息）
 */
function parseErrorChunk(line: string): string {
  try {
    const parsed: unknown = JSON.parse(line.slice(2));
    if (typeof parsed === "string" && parsed.length > 0) return parsed;
  } catch {
    // 非法 JSON（真实管线不会出现）：落到 SDK 缺省文案，交由 catch 按 unknown 分类
  }
  return "An error occurred.";
}

/** 坏工具调用兜底反馈工具名（经 activeTools 对模型隐藏，仅 repair 重定向可达） */
const TOOL_CALL_FEEDBACK_NAME = "__tool_call_feedback__";

/** 反馈中附带的工具 schema 序列化上限（防病态 schema 撑爆上下文） */
const FEEDBACK_SCHEMA_MAX_CHARS = 2048;

/** 坏工具调用兜底反馈工具：repairToolCall 的重定向目标（见 repairToolCallToFeedback） */
const toolCallFeedbackTool = zodTool({
  description:
    "系统内部兜底工具：承载上一次失败工具调用的错误详情。请勿主动调用；收到本工具的结果时，请按错误提示修正参数或改用真实存在的工具后重试。",
  parameters: z.object({
    toolName: z.string(),
    argsText: z.string(),
    reason: z.string(),
    schemaText: z.string().optional(),
  }),
  execute: async ({ toolName, argsText, reason, schemaText }) => ({
    error: `上一次对工具 "${toolName}" 的调用未执行：${reason}。原始参数：${argsText || "(空)"}。${
      schemaText ? `该工具的参数 JSON Schema：${schemaText}。` : ""
    }请按 schema 修正必填参数与类型后重新调用。`,
  }),
});

/**
 * 坏工具调用兜底重定向：模型输出空参数/类型错误参数（InvalidToolArgumentsError）
 * 或幻觉工具名（NoSuchToolError）时，错误会作为流内 error 终结整个会话——单次
 * 手误不应杀死整条流。这里把坏调用重定向到兜底反馈工具，错误详情（参数校验
 * 失败时附目标工具 JSON Schema，帮模型一次纠正成功）以 tool result 形式反馈
 * 给模型，由其在后续 step 按提示自我纠正。
 * 其他错误返回 null，维持 SDK 原生抛错路径。独立导出以便单测
 * （streamText 被上层 mock 时 experimental_repairToolCall 分支不可达）。
 */
export async function repairToolCallToFeedback(input: {
  toolCall: { toolCallId: string; toolName: string; args?: unknown };
  error: unknown;
  /** 目标工具 JSON Schema 提取（NoSuchTool 场景勿传：工具不存在，提取会崩） */
  parameterSchema?: (input: { toolName: string }) => unknown;
}): Promise<{
  toolCallType: "function";
  toolCallId: string;
  toolName: string;
  args: string;
} | null> {
  const { toolCall, error, parameterSchema } = input;
  const isInvalidArgs = InvalidToolArgumentsError.isInstance(error);
  const isNoSuch = NoSuchToolError.isInstance(error);
  if (!isInvalidArgs && !isNoSuch) return null;
  let reason: string;
  let schemaText: string | undefined;
  if (isNoSuch) {
    const available = (error as { availableTools?: unknown }).availableTools;
    const availableText = Array.isArray(available)
      ? (available as unknown[]).join(", ")
      : "";
    reason = `工具 "${toolCall.toolName}" 不存在${
      availableText ? `（可用工具：${availableText}）` : ""
    }`;
  } else {
    reason = error instanceof Error ? error.message : String(error);
    if (parameterSchema) {
      try {
        const serialized = JSON.stringify(
          parameterSchema({ toolName: toolCall.toolName })
        );
        if (typeof serialized === "string" && serialized.length > 0) {
          schemaText = serialized.slice(0, FEEDBACK_SCHEMA_MAX_CHARS);
        }
      } catch {
        // schema 提取失败不影响主反馈（错误详情已足够模型纠正）
      }
    }
  }
  const argsRaw = toolCall.args;
  const argsText =
    typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
  // LanguageModelV1FunctionToolCall 契约：args 为 JSON 文本（doParseToolCall 会
  // 重新按兜底工具 schema 校验），兜底工具必填字段在 JSON 内
  return {
    toolCallType: "function",
    toolCallId: toolCall.toolCallId,
    toolName: TOOL_CALL_FEEDBACK_NAME,
    args: JSON.stringify({
      toolName: toolCall.toolName,
      argsText,
      reason,
      ...(schemaText !== undefined ? { schemaText } : {}),
    }),
  };
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

/** 会话上下文元数据（投影式压缩的锚点与摘要缓存；与应用层会话存储同构） */
export interface SessionContextMeta {
  lastPromptTokens?: number;
  summary?: string;
  summaryUptoMessageId?: string;
  /**
   * 应用编排待执行状态（应用经 sessions 通道读写：如规划确认后待执行的
   * 方法/步骤标识；消费方负责消费后清空，防陈旧状态被复用）。
   */
  pendingPlan?: { methodIds: string[] } & Record<string, unknown>;
  [key: string]: unknown;
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
  /** 租户隔离命名空间；缺省 = principal。契约：不得含冒号（':' 是存储键分隔符）。 */
  tenantId?: string;
  /** 供配额/审计透传的自定义声明（如 allowEnvCredentials） */
  claims?: Record<string, unknown>;
}

export interface McpOptions {
  manager: MCPClientManager;
  getServers: () => Promise<MCPServerConfig[]> | MCPServerConfig[];
}

/** 平台装载的源摘要（结构兼容 datasources 包的 ActiveSourceSummary） */
export interface AppSourceSummary {
  id: string;
  name: string;
  kind?: string;
  dbType?: string;
  tools: string[];
}

/**
 * 应用解析上下文：注入 resolveAppPrompt / resolveAppTools / onTaskFinish 时
 * 平台向应用开放的请求级信息（结构与 app-sdk 的 AppServerContext 对齐，
 * 宿主组合根负责两者间的映射）。
 */
export interface AppResolutionContext {
  mode: "direct" | "plan" | "execute";
  sessionId?: string;
  messages: unknown[];
  /** 最新用户提问文本 */
  userQuery?: string;
  /** 请求体透传的数据源选择 */
  enabledSources?: string[];
  /** 平台装载的源摘要（当前为 MCP 源，含工具名） */
  activeSources: AppSourceSummary[];
  /** 会话上下文通道（应用编排状态如 pendingPlan 的持久化） */
  sessions?: SessionContextStore;
  /** 平台遥测告警出口（应用侧装配失败等经此入遥测事件流） */
  warn?: (code: string, detail: string) => void;
}

export interface AnalyzeHandlerOptions {
  /** MCP 扩展客户端与服务清单（可选注入） */
  mcp?: McpOptions;
  /** 会话上下文存取（可选注入；应用层为 src/lib/sessionStore 的适配器） */
  sessions?: SessionContextStore;
  /** 会话流中继中枢（可选注入；缺省全局单例 defaultStreamHub） */
  streamHub?: SessionStreamHub;
  /** 共享任务存储（可选注入；仅在未注入 streamHub 时生效，优先于 env） */
  taskStore?: TaskStore;
  /** owner 实例标识（可选注入；缺省 hostname:pid） */
  instanceId?: string;
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
   * tokenizer 映射表路径（可选注入）：仅在 `LLM_TOKENIZER=tiktoken` 时生效。
   * 缺省 `${cwd}/config/model-tokenizer.json`；宿主应注入存储根下的真实路径，
   * 避免存储根外移后仍读 cwd 造成配置分裂。
   */
  tokenizerConfigPath?: string;
  /**
   * 真实 tokenizer（可选注入，WS-12）：只影响投影预判定；usage.promptTokens
   * 实测锚点仍是最高优先级。缺省 CJK 启发式，行为不变；env LLM_TOKENIZER=tiktoken
   * 时按 config/model-tokenizer.json 映射动态加载 js-tiktoken（未安装回退启发式）。
   */
  tokenizer?: { encode(text: string): number };
  /** 模型元数据注册表（可选注入；缺省全局单例 defaultModelCatalog） */
  modelCatalog?: ModelCatalog;
  /**
   * 缺省应用 ID（可选注入）：请求体未携带 appId 时的归一值。
   * 宿主应注入其默认应用（如 DEFAULT_APP_ID）。
   */
  defaultAppId?: string;
  /**
   * 应用级系统提示词解析器（应用自治 prompt 的唯一来源）：
   * 返回 undefined 时使用平台中立兜底提示词（getPlatformBasePrompt）。
   */
  resolveAppPrompt?: (
    appId: string,
    ctx: AppResolutionContext
  ) => Promise<string | undefined> | string | undefined;
  /**
   * 应用级自主工具解析器：应用自治装配专属工具集（数据源工具、文件/命令行工具等），
   * 解析出的工具会经遥测切面包装后合并挂载给模型。
   */
  resolveAppTools?: (
    appId: string,
    ctx: AppResolutionContext
  ) =>
    | Promise<Record<string, CoreTool> | undefined>
    | Record<string, CoreTool>
    | undefined;
  /**
   * 应用交付物契约（可选注入，见 app-sdk AppDeliverableContract）：
   * finish_task 终态语义文案与交付物证据标记；未注入使用中立缺省。
   */
  deliverable?: AppDeliverableContract;
  /** 无 API Key 降级流的消息文案（可选注入；缺省中立引导文案） */
  noApiKeyMessage?: string;
  /**
   * 会话摘要提示词构造器（可选注入；缺省 harness-core 通用摘要提示词）。
   * 领域应用可注入保留领域要素（如指标/表名/已确认方案）的摘要指导。
   */
  summaryPromptBuilder?: (opts: {
    covered: CoreMessage[];
    previousSummary?: string;
  }) => string;
  /**
   * 任务收尾钩子（可选注入）：onFinish 后异步触发（fire-and-forget），
   * 应用用于登记编排状态（如 plan 阶段提取规划写入 pendingPlan）。
   */
  onTaskFinish?: (event: {
    appId: string;
    sessionId?: string;
    mode: "direct" | "plan" | "execute";
    finalText?: string;
    sessions?: SessionContextStore;
  }) => Promise<void> | void;
}

export interface AnalyzeRequestBody {
  action?: string;
  /** 所属应用 ID，缺省归一为 defaultAppId 选项值 */
  appId?: string;
  reconnect?: boolean;
  messages?: unknown[];
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number | string;
  reasoningEffort?: "low" | "medium" | "high";
  /** 显式声明该模型是否支持深度思考 / 推理（若不传则基于模型名智能推断） */
  supportsReasoning?: boolean;
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
   * 交互阶段（两阶段编排，语义由应用定义）：
   * - direct（缺省）：直接回复/产出
   * - plan：规划阶段——先探查与澄清，产出供用户确认的规划
   * - execute：执行阶段——按已确认的规划产出最终交付物
   */
  mode?: "direct" | "plan" | "execute";
  /** 会话 id（上下文治理：读取/回写计量锚点与摘要缓存；缺省则治理降级） */
  sessionId?: string;
  /** 客户端提供的模型窗口 hint（provider catalog 值；缺省服务端查表） */
  contextWindow?: number | string;
  /** 步数上限（Agent 循环熔断兜底），缺省读 env 或 25 */
  maxSteps?: number | string;
  /**
   * 任务累计 token 预算（prompt+completion 总和）：
   * 超限时立即写入 budget_exhausted 终态并中止 provider 生成，防成本敞口失控。
   * 缺省不限制；读 env LLM_TASK_TOKEN_BUDGET，显式给 >0 值启用（钳制 10k–5M），≤0 视为不限制。
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
 * `createAnalyzeHandler` 的返回面：可调用的 POST 处理函数 + 运行时观测/控制出口。
 *
 * 显式声明（而非依赖推断）的两个理由：
 *   1. 发布 dts 可移植性——推断会把 `@types/node` 的 undici fetch 类型族带进产物（TS2742）；
 *   2. 契约可见性——宿主经这些字段做探针（isSessionRunning）、指标（streamHub）、
 *      账本读取（costLedger），属于公共 API 面。
 */
export interface AnalyzeHandler {
  (req: Request): Promise<Response>;
  /** 会话是否有运行中的任务（GET /api/analyze 探针） */
  isSessionRunning(sessionId: string, tenantId?: string): Promise<boolean>;
  /** 主动中止会话任务（用户停止） */
  abortSession(sessionId: string, tenantId?: string): Promise<unknown>;
  /** 会话流中继（指标聚合、探针） */
  streamHub: SessionStreamHub;
  /** 成本台账（未启用时为 undefined，GET /api/usage 经此读取） */
  costLedger?: CostLedger;
}

/**
 * LLM 编排门面（领域中立）：注入平台设施与应用接缝，返回可直接作为 Next POST
 * 路由的处理函数。应用领域逻辑（prompt/工具装配/交付物语义）全部经
 * resolveAppPrompt / resolveAppTools / deliverable / onTaskFinish 注入。
 */
export function createAnalyzeHandler(
  opts: AnalyzeHandlerOptions
  // 显式返回类型：避免 dts 推断穿透到 undici-types（@types/node 的 fetch 类型族），
  // 导致发布产物类型声明不可移植（TS2742）。接口在下方 AnalyzeHandler 定义。
): AnalyzeHandler {
  const { sessions } = opts;
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
  const modelCatalog = opts.modelCatalog ?? defaultModelCatalog;

  // 应用交付物契约（缺省中立文案 + 平台 DSL 标记）
  const evidenceMarkers: string[] = opts.deliverable?.evidenceMarkers ?? ["```ginkgo"];
  const finishToolDescription: string =
    opts.deliverable?.toolDescription ??
    "显式宣告任务已达成终态并闭环。当所需信息获取完毕、交付物（结论/报告/产物）已就绪时调用。调用此工具表示本轮工作全部结束，无需再发起其他查询。";
  const finishRejectReason: string =
    opts.deliverable?.rejectReason ??
    "尚未输出任何实质性内容，不能宣告 completed。请先完成正式输出；若确属信息缺失或遇到阻塞，请改用 status=insufficient_data 或 status=blocked。";
  const finishWrapUpWithArtifact: string =
    opts.deliverable?.wrapUpWithArtifact ??
    "任务已确认闭环。若交付物已输出，严禁重复输出，直接输出一句简要闭环致辞即可自然结束；若尚未输出，请基于已获取的信息完成正式交付。";
  const finishWrapUpPlainText: string =
    opts.deliverable?.wrapUpPlainText ??
    "任务已确认闭环。请直接自然结束当前回复，无需重复输出。";
  const noApiKeyMessage =
    opts.noApiKeyMessage ??
    "⚠️ 请先在右上角「设置」中配置您的 API Key 后再开始对话。";
  const buildSummaryPrompt = opts.summaryPromptBuilder ?? buildGenericSummaryPrompt;

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
        reasoningEffort: clientReasoningEffort,
        supportsReasoning: clientSupportsReasoning,
        maxTokens: clientMaxTokens,
        sources: clientSources,
        protocol: clientProtocol,
        mode: clientMode,
        sessionId: clientSessionId,
        contextWindow: clientContextWindow,
        maxSteps: clientMaxSteps,
        budgetTokens: clientBudgetTokens,
        appId: rawClientAppId,
      } = rawBody;

      const clientAppId =
        typeof rawClientAppId === "string" && rawClientAppId.trim()
          ? rawClientAppId.trim()
          : (opts.defaultAppId ?? "app");

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
      const isReasoning =
        typeof clientSupportsReasoning === "boolean"
          ? clientSupportsReasoning
          : isReasoningModel(model);
      // 温度由客户端设置页透传，钳制在 0–2，默认 0.2；思考模型（o1, o3, R1）锁定温度
      const parsedTemp = Number(clientTemperature);
      const temperature = isReasoning
        ? undefined
        : Number.isFinite(parsedTemp) && clientTemperature !== undefined && clientTemperature !== ""
        ? Math.min(Math.max(parsedTemp, 0), 2)
        : 0.2;
      const reasoningEffort = isReasoning
        ? ["low", "medium", "high"].includes(String(clientReasoningEffort))
          ? (clientReasoningEffort as "low" | "medium" | "high")
          : "medium"
        : undefined;

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

      // 交互阶段归一化：非法值回落 direct，保持向后兼容
      const mode =
        clientMode === "plan" || clientMode === "execute" ? clientMode : "direct";

      // 步数预算（maxSteps 熔断上限）：客户端透传优先，其次环境变量 LLM_PLAN_MAX_STEPS / LLM_BUILD_MAX_STEPS / LLM_MAX_STEPS，
      // 缺省时默认：execute/direct 为 50 步，plan 为 25 步（防死循环熔断上限；双重终态机制保证模型在目标达成时通过 finish_task 或自然 stop 主动提前结束）
      const parsedClientMaxSteps = Number(clientMaxSteps);
      const envMaxSteps = Number(process.env.LLM_MAX_STEPS);
      const envPlanMaxSteps = Number(process.env.LLM_PLAN_MAX_STEPS);
      const envBuildMaxSteps = Number(
        process.env.LLM_BUILD_MAX_STEPS ?? process.env.LLM_EXECUTE_MAX_STEPS
      );

      const defaultMaxSteps =
        mode === "plan"
          ? Number.isFinite(envPlanMaxSteps) && envPlanMaxSteps > 0
            ? envPlanMaxSteps
            : Number.isFinite(envMaxSteps) && envMaxSteps > 0
              ? envMaxSteps
              : 25
          : Number.isFinite(envBuildMaxSteps) && envBuildMaxSteps > 0
            ? envBuildMaxSteps
            : Number.isFinite(envMaxSteps) && envMaxSteps > 0
              ? envMaxSteps
              : 50;

      const rawMaxSteps =
        Number.isFinite(parsedClientMaxSteps) && parsedClientMaxSteps > 0
          ? parsedClientMaxSteps
          : defaultMaxSteps;
      const maxSteps = Math.min(Math.max(Math.round(rawMaxSteps), 1), 150);

      // WS-3 任务累计 token 预算(prompt+completion 总和):缺省不限制(null)。
      // 客户端 budgetTokens 或 env LLM_TASK_TOKEN_BUDGET 显式给出 >0 值才启用限额
      // (钳制 10k–5M),超限即终态+中止;显式给 ≤0 视为不限制(显式逃逸口)。
      const envTokenBudgetRaw = process.env.LLM_TASK_TOKEN_BUDGET;
      const envTokenBudget = Number(envTokenBudgetRaw);
      const parsedTokenBudget = Number(clientBudgetTokens);
      const rawTokenBudget =
        Number.isFinite(parsedTokenBudget) && clientBudgetTokens !== undefined && clientBudgetTokens !== ""
          ? parsedTokenBudget
          : envTokenBudgetRaw !== undefined && Number.isFinite(envTokenBudget)
            ? envTokenBudget
            : null;
      const taskTokenBudget =
        rawTokenBudget !== null && rawTokenBudget > 0
          ? Math.min(Math.max(Math.round(rawTokenBudget), 10_000), 5_000_000)
          : null;

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
        const msg = noApiKeyMessage;
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

      const loadedTools: Record<string, CoreTool> = {};
      /** 平台装载的源摘要（MCP 源；应用自有数据源摘要由应用自行装配） */
      const mcpSummaries: AppSourceSummary[] = [];

      // 装配已启用的 MCP 扩展工具集（平台级数据面，应用无关）
      if (opts.mcp) {
        try {
          const mcpConfigs = await opts.mcp.getServers();
          const allEnabled = (
            Array.isArray(mcpConfigs) ? mcpConfigs : []
          ).filter((s) => s.enabled !== false);
          // 若客户端明确限定了 sources，则按 sources 过滤，否则全量装载已启用的 MCP
          const targetServers = clientSources
            ? allEnabled.filter((s) => (clientSources as string[]).includes(s.id))
            : allEnabled;

          if (targetServers.length > 0) {
            opts.mcp.manager.registerServers(targetServers);

            for (const server of targetServers) {
              try {
                const serverTools = await getCoreToolsFromMcp(
                  opts.mcp.manager,
                  [server]
                );
                const toolNames = Object.keys(serverTools);
                if (toolNames.length > 0) {
                  mergeToolSets(
                    loadedTools,
                    instrumentTools(serverTools, {
                      runId,
                      sessionId: sessionIdForEvents,
                      sourceId: server.id,
                      telemetry,
                      mode,
                    }),
                    server.id
                  );
                  mcpSummaries.push({
                    id: server.id,
                    name: server.name || server.id,
                    kind: "mcp",
                    tools: toolNames,
                  });
                } else {
                  telemetry.emit({
                    type: "warn",
                    runId,
                    sessionId: sessionIdForEvents,
                    code: "MCP_SERVER_LOAD_FAILED",
                    detail: `MCP 服务 [${server.id}] 未发现可用工具或连接失败，降级跳过`,
                  });
                }
              } catch (serverErr) {
                telemetry.emit({
                  type: "warn",
                  runId,
                  sessionId: sessionIdForEvents,
                  code: "MCP_SERVER_LOAD_FAILED",
                  detail: `MCP 服务 [${server.id}] 工具装配失败，降级跳过: ${
                    serverErr instanceof Error
                      ? serverErr.message
                      : String(serverErr)
                  }`,
                });
              }
            }
          }
        } catch (mcpErr) {
          telemetry.emit({
            type: "warn",
            runId,
            sessionId: sessionIdForEvents,
            code: "MCP_CONFIG_LOAD_FAILED",
            detail: `MCP 配置加载失败: ${
              mcpErr instanceof Error ? mcpErr.message : String(mcpErr)
            }`,
          });
        }
      }

      // 应用解析上下文（平台向应用开放的请求级信息）
      const appCtx: AppResolutionContext = {
        mode,
        sessionId: typeof clientSessionId === "string" && clientSessionId ? clientSessionId : undefined,
        messages,
        userQuery: extractLatestUserQuery(messages),
        enabledSources: Array.isArray(clientSources) ? (clientSources as string[]) : undefined,
        activeSources: mcpSummaries,
        sessions,
        warn: (code, detail) => {
          telemetry.emit({ type: "warn", runId, sessionId: sessionIdForEvents, code, detail });
        },
      };

      // 装配应用自治工具集（数据源工具 / 文件与命令行工具等，全部由应用声明）
      if (opts.resolveAppTools) {
        try {
          const appTools = await opts.resolveAppTools(clientAppId, appCtx);
          if (appTools && Object.keys(appTools).length > 0) {
            mergeToolSets(
              loadedTools,
              instrumentTools(appTools, {
                runId,
                sessionId: sessionIdForEvents,
                sourceId: `app:${clientAppId}`,
                telemetry,
                mode,
              }),
              `app:${clientAppId}`
            );
          }
        } catch (appToolErr) {
          telemetry.emit({
            type: "warn",
            runId,
            sessionId: sessionIdForEvents,
            code: "APP_TOOLS_LOAD_FAILED",
            detail: `应用 [${clientAppId}] 自治工具装配失败，降级跳过: ${
              appToolErr instanceof Error ? appToolErr.message : String(appToolErr)
            }`,
          });
        }
      }

      // 会话上下文元数据提前读取:投影锚点（token 锚点/摘要缓存）用;
      // 读取失败静默降级（仅当次启发式，不阻塞分析）
      const sessionCtx =
        sessions && typeof clientSessionId === "string" && clientSessionId
          ? await sessions.getContext(clientSessionId).catch(() => undefined)
          : undefined;

      // 应用自治提示词优先：应用未提供时回退平台中立兜底；
      // 平台注入防御纪律段对所有 prompt 强制生效（已包含时不重复追加）
      const appCustomPrompt = opts.resolveAppPrompt
        ? await opts.resolveAppPrompt(clientAppId, appCtx)
        : undefined;
      const baseSystem = withPlatformGuardrails(
        appCustomPrompt && appCustomPrompt.trim() ? appCustomPrompt : getPlatformBasePrompt()
      );

      // ========== 上下文治理（投影式压缩，设计见 context.ts） ==========
      // sessionCtx 已在上方提前读取(投影锚点)
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
          tokenizer: await resolveRequestTokenizer(
            opts.tokenizer,
            model,
            opts.tokenizerConfigPath ??
              `${process.cwd()}/config/model-tokenizer.json`
          ),
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

      // 使用现代 createDataStreamResponse 管理流生命周期，避免旧 StreamData 15秒悬挂超时警告与异常中止泄漏
      const runStartTs = Date.now();
      let stepIndex = 0;
      let prevStepTs = runStartTs;
      let lastStepPromptTokens: number | undefined;
      let lastStepFinishReason: string | undefined;
      let explicitFinishDetails: { status: string; summary?: string } | undefined;
      /** 最后一步的模型文本(onTaskFinish 钩子据此提取编排状态) */
      let lastStepText: string | undefined;
      // 交付物证据:跨步骤累计（证据标记命中或实质性文本产出）
      let hasArtifactEvidence = false;
      let totalTextChars = 0;
      // 任务级中止控制器:abortTask(用户停止/看门狗超时)经 hub 触发后传导进
      // streamText 并以 error 语义终止订阅;预算熔断走独立 controller——只取消
      // provider 生成,流自然收尾(客户端已收到 task_finish,订阅不得 error)
      const taskAbortController = new AbortController();
      const budgetAbortController = new AbortController();
      // WS-3 累计 token 计量(prompt+completion 总和):启用预算时超限立即终态+中止;
      // 未配置预算(缺省)只计量不熔断
      let totalTokens = 0;
      let budgetExceeded = false;

      const rawResponse = createDataStreamResponse({
        execute: async (dataStream) => {
          // 平台通用流式心跳保活（Keep-Alive SSE）：每 15 秒向流中下发一条心跳分块，
          // 确保模型长思考或工具长耗时执行期间 TCP 管道与 HTTP 代理始终活跃，彻底防御 Socket 空闲断开
          const keepAliveTimer = setInterval(() => {
            try {
              dataStream.writeData({ type: "keep_alive", ts: Date.now() });
            } catch {
              // 流若已关闭，忽略写入异常
            }
          }, 15000);

          try {
          // 双重终态机制：显式终态工具 finish_task（基于 @ginkgo/harness-core 终态契约）
          const finishTaskTool = createTerminationTool({
            toolName: "finish_task",
            description: finishToolDescription,
            assertion: () => {
              // 服务端不变量: 校验任务是否有实质性产出证据
              // 产出形式包含：交付物证据标记命中（应用契约声明）、或实质性文本内容。
              // 唯有两者皆无（模型未输出任何实质内容却宣告完成）时，才予以拒绝，避免空跑兜底。
              const hasOutputEvidence = hasArtifactEvidence || totalTextChars > 0;
              return {
                passed: hasOutputEvidence,
                rejectReason: finishRejectReason,
              };
            },
            onSignalRejected: () => {
              telemetry.emit({
                type: "warn",
                runId,
                sessionId: sessionIdForEvents,
                code: "FINV_GATE_REJECTED",
                detail: `finish_task(completed) 被拒:无任何实质性产出证据`,
              });
            },
            onSignalAccepted: (sig) => {
              explicitFinishDetails = {
                status: sig.status,
                summary: sig.deliverableSummary,
              };
              dataStream.writeData({
                type: "task_finish",
                termination: "explicit",
                status: sig.status,
                summary: sig.deliverableSummary ?? "",
              });
            },
            resolveMessage: () => {
              return hasArtifactEvidence
                ? finishWrapUpWithArtifact
                : finishWrapUpPlainText;
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
                ...(temperature !== undefined ? { temperature } : {}),
                ...(reasoningEffort ? { providerOptions: { openai: { reasoningEffort } } } : {}),
                // AI SDK v1 参数名为 maxTokens（透传 max_tokens；Anthropic 端点必填）
                maxTokens: maxOutputTokens,
                // 任务中止信号:任一来源(硬停止/预算熔断)取消 provider 生成
                abortSignal: anySignal([
                  taskAbortController.signal,
                  budgetAbortController.signal,
                ]),
                tools: {
                  ...loadedTools,
                  finish_task: finishTaskTool,
                  // 坏工具调用兜底：experimental_repairToolCall 的重定向目标
                  [TOOL_CALL_FEEDBACK_NAME]: toolCallFeedbackTool,
                } as Record<string, CoreTool>,
                // 兜底工具对模型隐藏（activeTools 只过滤模型可见列表，repair
                // 重定向后的执行走完整 tools 表不受影响）——防止模型主动调用
                // 或模仿其命名
                experimental_activeTools: [
                  ...Object.keys(loadedTools),
                  "finish_task",
                ],
                maxSteps,
                // 坏工具调用（参数校验失败/工具名不存在）不终结流：重定向到兜底
                // 反馈工具，错误+目标工具 schema 以 tool result 反馈给模型自我纠正
                experimental_repairToolCall: async (options) => {
                  const repaired = await repairToolCallToFeedback({
                    toolCall: options.toolCall,
                    error: options.error,
                    parameterSchema: options.parameterSchema,
                  });
                  if (repaired) {
                    // 坏调用根因可诊断：模型原始输出与校验失败原因全量落遥测
                    let detail = "";
                    try {
                      const parsed = JSON.parse(repaired.args) as {
                        reason?: string;
                        argsText?: string;
                      };
                      detail = `${parsed.reason ?? ""} | 原始args=${parsed.argsText ?? ""}`;
                    } catch {
                      detail = repaired.args;
                    }
                    telemetry.emit({
                      type: "warn",
                      runId,
                      sessionId: sessionIdForEvents,
                      code: "TOOL_CALL_REPAIRED",
                      detail,
                    });
                  }
                  return repaired;
                },
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
                    (chunk.type as string) === "tool-result"
                  ) {
                    emittedContent = true;
                  }
                },
                onStepFinish({ text, toolCalls, finishReason, usage }) {
                  stepIndex++;
                  if (typeof text === "string" && text.length > 0) {
                    lastStepText = text;
                    totalTextChars += text.trim().length;
                    // 交付物证据跨步骤累计(报告与交付物可能分步输出)
                    if (evidenceMarkers.some((m) => text.includes(m))) {
                      hasArtifactEvidence = true;
                    }
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
                  // 累计预算熔断(仅在显式配置预算时启用):超限写终态并中止 provider
                  // (客户端按既有 status=truncated 渲染)
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
                    if (taskTokenBudget !== null && !budgetExceeded && totalTokens > taskTokenBudget) {
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
                    } else if (lastStepFinishReason === "tool-calls") {
                      // 关键修复：模型在最后一步声明调用工具，但流已终结（说明达到 maxSteps 步数上限或工具未能执行）
                      // 属于异常截断，诚实对齐为 step_limit_reached / truncated，绝不粉饰为 completed
                      termination = "step_limit_reached";
                      status = "truncated";
                      telemetry.emit({
                        type: "warn",
                        runId,
                        sessionId: sessionIdForEvents,
                        code: "EMPTY_OR_UNEXECUTED_TOOL_CALLS",
                        detail: `最后一步 finishReason 为 tool-calls 但流已终结，判定为步数上限到达或未执行工具截断`,
                      });
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

                  // 应用收尾钩子（fire-and-forget）：登记编排状态（如 plan 阶段提取规划）
                  if (opts.onTaskFinish) {
                    void Promise.resolve(
                      opts.onTaskFinish({
                        appId: clientAppId,
                        sessionId:
                          typeof clientSessionId === "string" && clientSessionId
                            ? clientSessionId
                            : undefined,
                        mode,
                        finalText: lastStepText,
                        sessions,
                      })
                    ).catch(() => {});
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
                .toDataStream({
                  sendReasoning: true,
                  // ai@4 缺省把流内 provider 失败脱敏为 "An error occurred."
                  // （toDataStreamInternal 的 getErrorMessage 缺省值）——真实原因既
                  // 不落遥测也无法向用户解释，这里还原原始错误消息
                  getErrorMessage: (err: unknown) =>
                    err instanceof Error ? err.message : String(err),
                })
                .getReader();
              const decoder = new TextDecoder();
              // toDataStream 产出的是规范化 data stream 分块串（0:/2:/3:/d: 前缀）
              type DataStreamChunk = Parameters<typeof dataStream.write>[0];
              try {
                // provider 失败在本管线有两副面孔，都要变成真实抛错才能进入下方
                // catch 的分类/fallback/遥测：
                // 1. reader.read() 直接 reject（传输层中断等少数路径）；
                // 2. toDataStreamInternal 把 fullStream 的 error chunk 吞成 3: 错误
                //    分块继续下发（真实 SDK 的常态，含用户停止的 AbortError）——
                //    下行按行检测 3: 前缀并抛出。
                // 分块以 \n 结尾，但 read 的字节边界未必对齐分块边界：先拼行缓冲，
                // 完整行才判定前缀，残段滚入下一轮（流尾 flush）。
                let fragment = "";
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  fragment += decoder.decode(value, { stream: true });
                  const lines = fragment.split("\n");
                  fragment = lines.pop() ?? "";
                  for (const line of lines) {
                    if (line.startsWith("3:")) {
                      throw new Error(parseErrorChunk(line));
                    }
                    if (line) {
                      dataStream.write(`${line}\n` as DataStreamChunk);
                    }
                  }
                }
                const tail = fragment + decoder.decode();
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
                  throw err;
                }
                const rawErrMsg = err instanceof Error ? err.message : String(err);
                telemetry.emit({
                  type: "error",
                  runId,
                  sessionId: sessionIdForEvents,
                  code: "PROVIDER_CALL_FAILED",
                  detail: `模型 [${spec.model}] 调用失败: ${rawErrMsg}`,
                });
                const friendlyMsg = `⚠️ **大模型服务响应异常**\n\n- **所用模型**：\`${spec.model}\`\n- **异常详情**：\`${rawErrMsg}\`\n\n> **排查建议**：\n> 1. 请点击右上角「设置」进入「模型配置」，检查所填写的 **模型名称**（如 \`${spec.model}\` 是否支持）、**API Key** 和 **Base URL**；\n> 2. 若使用 DeepSeek 官方服务，常用模型名为 \`deepseek-chat\` 或 \`deepseek-reasoner\`；\n> 3. 检查网络、代理或中转平台额度是否充足。修改配置后，您可以直接在下方继续提问。`;
                dataStream.write(`0:${JSON.stringify(friendlyMsg)}\n`);
                dataStream.write(`d:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n`);
                return;
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
          } finally {
            clearInterval(keepAliveTimer);
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
