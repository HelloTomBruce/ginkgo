import fs from "node:fs";
import path from "node:path";
import { importRedisConstructor, type RedisLike } from "./redisTaskStore";

/**
 * 成本台账与配额（WS-11）：
 * token 计量从「遥测事件流里的数字」升级为「可持久化、可查询、可准入拦截的账」。
 *
 * - 写入点：handler onFinish（task_finish 处），口径 = SDK 累计值（与遥测一致）
 * - 准入点：QuotaPolicy 存在且租户滚动窗累计超限 → 429（与单任务预算正交）
 * - 多副本部署必须注入 RedisCostLedger：进程内实现等于每实例一份额度，语义错误
 *
 * 台账失败绝不阻塞主链路：record 由调用方 fire-and-forget + catch。
 */

export interface UsageRecord {
  runId: string;
  /** WS-10 租户命名空间；未注入 authenticate 时为 "anon" */
  tenantId: string;
  sessionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 单价表命中时计算；缺单价则 undefined（只记量不记钱） */
  costUsd?: number;
  finishedAt: number;
}

export interface CostLedger {
  record(entry: UsageRecord): Promise<void>;
  /** 窗口期累计（配额判定用）；windowMs 滚动窗，截止 now */
  sumUsage(tenantId: string, windowMs: number): Promise<{ tokens: number; costUsd: number }>;
}

/** 配额策略（可选注入；缺省不启用，行为与现状一致） */
export interface QuotaPolicy {
  /** 每租户滚动窗 token 上限（prompt+completion 总和）；累计 >= 上限时新任务 429 */
  tenantTokenLimit?: number;
  /** 滚动窗宽度；缺省 24h */
  windowMs?: number;
}

export const DEFAULT_QUOTA_WINDOW_MS = 86_400_000;

// ========== 计价表（用户维护，零硬编码；热加载沿用 mtime 检查模式） ==========

/** 模型单价：USD / 1M tokens（input/output 分列） */
export interface ModelPricing {
  input: number;
  output: number;
}

const PRICING_PATH_DEFAULT = path.join(process.cwd(), "config", "model-pricing.json");

/**
 * config/model-pricing.json：`{ "gpt-4o": { "input": 2.5, "output": 10 }, ... }`。
 * 模型名前缀匹配（最长前缀优先，同 context.ts 窗口表语义）；文件缺失/未命中
 * = 只记量不记钱，不阻塞任何主链路。
 */
export class ModelPricingTable {
  readonly #configPath: string;
  #cache: Record<string, ModelPricing> | null = null;
  #mtimeMs = -1;

  constructor(configPath: string = PRICING_PATH_DEFAULT) {
    this.#configPath = configPath;
  }

  /** 文件 mtime 变化时重载（改 config 无需重启进程）；读失败静默清空缓存 */
  reloadIfChanged(): void {
    try {
      const stat = fs.statSync(this.#configPath);
      if (stat.mtimeMs === this.#mtimeMs) return;
      this.#mtimeMs = stat.mtimeMs;
      const parsed: unknown = JSON.parse(fs.readFileSync(this.#configPath, "utf-8"));
      if (!parsed || typeof parsed !== "object") {
        this.#cache = null;
        return;
      }
      const entries: Record<string, ModelPricing> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as ModelPricing).input === "number" &&
          typeof (value as ModelPricing).output === "number"
        ) {
          entries[key] = value as ModelPricing;
        }
      }
      this.#cache = entries;
    } catch {
      this.#cache = null;
      this.#mtimeMs = -1;
    }
  }

  /** 最长前缀匹配；未命中返回 undefined */
  priceFor(model: string): ModelPricing | undefined {
    this.reloadIfChanged();
    const table = this.#cache;
    if (!table) return undefined;
    const lower = model.toLowerCase();
    let best: string | undefined;
    for (const key of Object.keys(table)) {
      if (
        lower.startsWith(key.toLowerCase()) &&
        (best === undefined || key.length > best.length)
      ) {
        best = key;
      }
    }
    return best === undefined ? undefined : table[best];
  }
}

/** USD 计价：6 位小数（微美元级），避免浮点累加误差进账本 */
export function computeCostUsd(
  pricing: ModelPricing,
  promptTokens: number,
  completionTokens: number
): number {
  const usd = (promptTokens / 1e6) * pricing.input + (completionTokens / 1e6) * pricing.output;
  return Number(usd.toFixed(6));
}

// ========== InMemory（缺省；进程内额度语义，仅单进程部署） ==========

export class InMemoryCostLedger implements CostLedger {
  readonly #records: UsageRecord[] = [];

  async record(entry: UsageRecord): Promise<void> {
    this.#records.push({ ...entry });
  }

  async sumUsage(tenantId: string, windowMs: number): Promise<{ tokens: number; costUsd: number }> {
    const since = Date.now() - windowMs;
    let tokens = 0;
    let costUsd = 0;
    for (const r of this.#records) {
      if (r.tenantId !== tenantId || r.finishedAt < since) continue;
      tokens += r.promptTokens + r.completionTokens;
      costUsd += r.costUsd ?? 0;
    }
    return { tokens, costUsd: Number(costUsd.toFixed(6)) };
  }
}

// ========== Ndjson（单机持久：append-only 文件，启动回放建索引） ==========

export interface NdjsonCostLedgerOptions {
  /** 账本文件路径；缺省 `${cwd}/data/cost-ledger.ndjson` */
  filePath?: string;
}

export class NdjsonCostLedger implements CostLedger {
  readonly #filePath: string;
  #records: UsageRecord[] | null = null;

  constructor(opts: NdjsonCostLedgerOptions = {}) {
    this.#filePath = opts.filePath ?? path.join(process.cwd(), "data", "cost-ledger.ndjson");
  }

  /** 首次使用懒加载回放（重启后重建索引）；坏行跳过不阻塞 */
  #ensureLoaded(): UsageRecord[] {
    if (this.#records) return this.#records;
    const records: UsageRecord[] = [];
    try {
      const raw = fs.readFileSync(this.#filePath, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as UsageRecord;
          if (
            parsed &&
            typeof parsed.runId === "string" &&
            typeof parsed.tenantId === "string" &&
            typeof parsed.finishedAt === "number"
          ) {
            records.push(parsed);
          }
        } catch {
          // 半写/损坏行跳过：账本只丢脏数据不丢服务
        }
      }
    } catch {
      // 文件不存在：空账本起步
    }
    this.#records = records;
    return records;
  }

  async record(entry: UsageRecord): Promise<void> {
    const records = this.#ensureLoaded();
    records.push({ ...entry });
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    fs.appendFileSync(this.#filePath, `${JSON.stringify(entry)}\n`, "utf-8");
  }

  async sumUsage(tenantId: string, windowMs: number): Promise<{ tokens: number; costUsd: number }> {
    const since = Date.now() - windowMs;
    let tokens = 0;
    let costUsd = 0;
    for (const r of this.#ensureLoaded()) {
      if (r.tenantId !== tenantId || r.finishedAt < since) continue;
      tokens += r.promptTokens + r.completionTokens;
      costUsd += r.costUsd ?? 0;
    }
    return { tokens, costUsd: Number(costUsd.toFixed(6)) };
  }
}

// ========== Redis（多副本必须：zset 滚动窗，与 WS-8 共用 keyPrefix 风格） ==========

export interface RedisCostLedgerOptions {
  /** redis:// 连接串；与 client 二选一（client 优先，供测试注入 mock） */
  url?: string;
  /** 命令连接；注入时不再动态 import ioredis */
  client?: RedisLike;
}

const LEDGER_KEY = (tenantId: string) => `harness:ledger:${tenantId}`;

export class RedisCostLedger implements CostLedger {
  #client?: RedisLike;
  readonly ready: Promise<void>;

  constructor(opts: RedisCostLedgerOptions = {}) {
    this.ready = this.init(opts);
  }

  private async init(opts: RedisCostLedgerOptions): Promise<void> {
    if (opts.client) {
      this.#client = opts.client;
      return;
    }
    if (!opts.url) {
      throw new Error("RedisCostLedger 需要 url 或注入 client");
    }
    const createClient = await importRedisConstructor();
    this.#client = new createClient(opts.url);
  }

  private async client(): Promise<RedisLike> {
    await this.ready;
    return this.#client!;
  }

  async record(entry: UsageRecord): Promise<void> {
    const c = await this.client();
    // member = 完整记录 JSON：runId 在 member 内保证唯一语义，重复 record 同 run
    // 仅更新 score（幂等），不产生双份
    await c.zadd(LEDGER_KEY(entry.tenantId), entry.finishedAt, JSON.stringify(entry));
  }

  async sumUsage(tenantId: string, windowMs: number): Promise<{ tokens: number; costUsd: number }> {
    const c = await this.client();
    // min/max 用字符串形态：ioredis-mock 的 reply transformer 对裸数字会崩，
    // 字符串在真实 ioredis 与 mock 上行为一致。
    const since = String(Date.now() - windowMs);
    const members = await c.zrangebyscore(LEDGER_KEY(tenantId), since, "+inf");
    let tokens = 0;
    let costUsd = 0;
    for (const member of members) {
      try {
        const r = JSON.parse(member) as UsageRecord;
        tokens += r.promptTokens + r.completionTokens;
        costUsd += r.costUsd ?? 0;
      } catch {
        // 坏成员跳过
      }
    }
    return { tokens, costUsd: Number(costUsd.toFixed(6)) };
  }
}
