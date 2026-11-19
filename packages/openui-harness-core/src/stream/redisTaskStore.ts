import type { AbortReason } from "../telemetry/telemetry";
import type { TaskSnapshot, TaskStatus, TaskStore } from "./taskStore";

/**
 * 多副本 TaskStore 后端：任务状态、分块、订阅广播全部落在共享 Redis，
 * 使任意副本可服务任何会话的重连/中止，LB 无需粘性。
 *
 * 键规约（与部署文档 docs/llm-harness-multi-instance.md 保持一致）：
 * - `harness:task:{sessionKey}`            hash   —— snapshot 元数据
 * - `harness:task:{sessionKey}:chunks`     list   —— base64 分块；running 期 TTL 10min
 *   由 owner 心跳续期，终态 30s 后过期删除
 * - `harness:chan:{sessionKey}`            pub/sub—— live 分块与终态关闭广播
 * - `harness:control`                      pub/sub—— 单频道 abort 广播
 * - `harness:lease:{sessionKey}`           string —— owner instanceId，TTL 15s（可配），心跳刷新
 * - `harness:running`                      set    —— 分布式准入计数（create SADD / 终态 SREM / 清扫器对账）
 *
 * 依赖形态：`ioredis` 为 peer optional + 动态 import()——单进程部署（memory/file）
 * 不安装不受影响；redis 模式下未安装时所有操作以含安装指引的错误拒绝。
 * 实现只用基础命令（hash/list/set/string/pubsub/TTL），不用 Lua，
 * 与 ioredis-mock 的行为差异风险最小化（CI 用 mock，真实拓扑由手动清单兜底）。
 */

const TASK_KEY = (sessionKey: string) => `harness:task:${sessionKey}`;
const CHUNKS_KEY = (sessionKey: string) => `harness:task:${sessionKey}:chunks`;
const CHUNKS_CHAN_PREFIX = "harness:chan:";
const CHUNKS_CHAN = (sessionKey: string) => `${CHUNKS_CHAN_PREFIX}${sessionKey}`;
const CONTROL_CHAN = "harness:control";
const LEASE_KEY = (sessionKey: string) => `harness:lease:${sessionKey}`;
const RUNNING_SET = "harness:running";

/** running 期 task hash 与 chunks list 的兜底 TTL（10 分钟，心跳续期） */
const RUNNING_TTL_SECONDS = 600;
/** 终态保留 30 秒后过期删除（与单机实现的终态重放窗一致） */
const TERMINAL_RETENTION_SECONDS = 30;

/** 清扫器回收 running 任务时写入的 error 消息（重连方按 error 语义收尾） */
export const OWNER_LOST_ERROR_MESSAGE = "owner_lost";

/**
 * 本实现使用的 Redis 命令面（结构化最小接口）：ioredis 与 ioredis-mock
 * 均结构兼容；不经由此接口引入 ioredis 的运行时依赖（peer optional）。
 */
export interface RedisLike {
  hset(key: string, data: Record<string, string>): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  scard(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  /** 成本台账：member 唯一（重复写入同 member 仅更新 score），score=finishedAt */
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  publish(channel: string, message: string): Promise<unknown>;
  duplicate(): RedisLike;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): this;
}

/**
 * 动态加载 ioredis 构造器（peer optional，单机部署不安装不受影响）：
 * 缺失时抛含安装指引的明确错误。RedisTaskStore 与 RedisCostLedger 共用。
 */
export async function importRedisConstructor(): Promise<new (url: string) => RedisLike> {
  try {
    // SAFETY: ioredis 为 CJS default 导出构造器；动态 import 的模块形状无法静态断言，
    // 运行时由 new 调用与命令面结构兼容性（RedisLike）约束。
    const mod = (await import("ioredis")) as unknown as {
      default?: new (url: string) => RedisLike;
    };
    // SAFETY: 无 bundler interop 的 ESM 命名空间形态下 default 可能不存在，回落到模块本身。
    return (
      mod.default ?? (mod as unknown as new (url: string) => RedisLike)
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "需要 ioredis，但当前进程未安装：多副本部署请执行 `pnpm add ioredis` 后重启；单进程部署请改用 LLM_TASK_STORE=memory 或 file。"
      );
    }
    throw error;
  }
}

export interface RedisTaskStoreOptions {
  /** redis:// 连接串；与 client 二选一（client 优先，供测试注入 mock） */
  url?: string;
  /** 命令连接；注入时不再动态 import ioredis */
  client?: RedisLike;
  /** 订阅连接；缺省由 client.duplicate() 派生（订阅模式连接不能执行普通命令） */
  subscriber?: RedisLike;
}

interface LiveHandler {
  onChunk: (chunk: Uint8Array, seq: number) => void;
  onClose?: (status: TaskStatus, errorMessage?: string) => void;
}

/** pub/sub 消息封装：分块 {t:"c",s,d} / 终态关闭 {t:"e",st,m} / abort {k,r} */
function encodeChunkMessage(seq: number, base64: string): string {
  return JSON.stringify({ t: "c", s: seq, d: base64 });
}
function encodeCloseMessage(status: TaskStatus, errorMessage?: string): string {
  return JSON.stringify({ t: "e", st: status, ...(errorMessage !== undefined ? { m: errorMessage } : {}) });
}

export class RedisTaskStore implements TaskStore {
  /** 多副本语义声明：hub 据此启动孤儿清扫器（单机后端不声明） */
  readonly multiReplica = true as const;
  #client?: RedisLike;
  #subscriber?: RedisLike;
  /** 连接（或依赖加载）完成即 resolve；ioredis 缺失时 reject 且携带安装指引 */
  readonly ready: Promise<void>;
  readonly #controlHandlers = new Set<(sessionKey: string, reason: AbortReason) => void>();
  readonly #chunkHandlers = new Map<string, Set<LiveHandler>>();
  #controlSubscribed = false;

  constructor(opts: RedisTaskStoreOptions = {}) {
    this.ready = this.init(opts);
  }

  private async init(opts: RedisTaskStoreOptions): Promise<void> {
    if (opts.client) {
      this.#client = opts.client;
      this.#subscriber = opts.subscriber ?? opts.client.duplicate();
    } else {
      if (!opts.url) {
        throw new Error("RedisTaskStore 需要 url 或注入 client");
      }
      const createClient = await importRedisConstructor();
      this.#client = new createClient(opts.url);
      this.#subscriber = opts.subscriber ?? this.#client.duplicate();
    }
    this.#subscriber.on("message", (channel, message) => this.dispatch(channel, message));
  }

  private async client(): Promise<RedisLike> {
    await this.ready;
    return this.#client!;
  }

  private async subscriber(): Promise<RedisLike> {
    await this.ready;
    return this.#subscriber!;
  }

  async create(snapshot: TaskSnapshot): Promise<void> {
    const c = await this.client();
    // 同键新任务先清旧代际痕迹：旧分块列表与终态 TTL 不得混入新任务的重放视图
    // （HSET 不会清除既有 TTL，靠显式 expire 覆盖）。
    await c.del(CHUNKS_KEY(snapshot.sessionKey));
    await c.hset(TASK_KEY(snapshot.sessionKey), this.encodeSnapshot(snapshot));
    if (snapshot.status === "running") {
      await c.expire(TASK_KEY(snapshot.sessionKey), RUNNING_TTL_SECONDS);
      await c.sadd(RUNNING_SET, snapshot.sessionKey);
    } else {
      await c.expire(TASK_KEY(snapshot.sessionKey), TERMINAL_RETENTION_SECONDS);
    }
  }

  async appendChunk(sessionKey: string, chunk: Uint8Array): Promise<void> {
    const c = await this.client();
    const base64 = Buffer.from(chunk).toString("base64");
    // 先持久化再广播：重放视图与 live 视图看到同一条提交边界；
    // RPUSH 返回值 = 新列表长度 = 分块序号（1 起），重连方依此去重订阅/重放双份。
    const seq = await c.rpush(CHUNKS_KEY(sessionKey), base64);
    await c.expire(CHUNKS_KEY(sessionKey), RUNNING_TTL_SECONDS);
    await c.publish(CHUNKS_CHAN(sessionKey), encodeChunkMessage(seq, base64));
  }

  async setStatus(
    sessionKey: string,
    status: TaskStatus,
    errorMessage?: string
  ): Promise<void> {
    const c = await this.client();
    const key = TASK_KEY(sessionKey);
    // 与内存实现一致：任务不存在时静默忽略，不得凭空复活快照
    if ((await c.hget(key, "status")) === null) return;
    await c.hset(key, {
      status,
      updatedAt: String(Date.now()),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    });
    if (status === "running") return;
    // 终态：释放准入名额 + 30s 过期（owner 本地清理之外的自愈删除）+ 广播关闭
    await c.srem(RUNNING_SET, sessionKey);
    await c.expire(key, TERMINAL_RETENTION_SECONDS);
    await c.expire(CHUNKS_KEY(sessionKey), TERMINAL_RETENTION_SECONDS);
    await c.publish(CHUNKS_CHAN(sessionKey), encodeCloseMessage(status, errorMessage));
  }

  async get(sessionKey: string): Promise<TaskSnapshot | undefined> {
    const c = await this.client();
    return this.decodeSnapshot(await c.hgetall(TASK_KEY(sessionKey)));
  }

  async getChunks(sessionKey: string): Promise<Uint8Array[]> {
    const c = await this.client();
    const raw = await c.lrange(CHUNKS_KEY(sessionKey), 0, -1);
    return raw.map((line) => new Uint8Array(Buffer.from(line, "base64")));
  }

  async delete(sessionKey: string): Promise<void> {
    const c = await this.client();
    await c.del(TASK_KEY(sessionKey), CHUNKS_KEY(sessionKey), LEASE_KEY(sessionKey));
    await c.srem(RUNNING_SET, sessionKey);
  }

  async runningCount(): Promise<number> {
    const c = await this.client();
    return c.scard(RUNNING_SET);
  }

  subscribeChunks(
    sessionKey: string,
    onChunk: (chunk: Uint8Array, seq: number) => void,
    onClose?: (status: TaskStatus, errorMessage?: string) => void
  ): () => void {
    const handlers = this.#chunkHandlers.get(sessionKey) ?? new Set<LiveHandler>();
    const handler: LiveHandler = { onChunk, onClose };
    handlers.add(handler);
    this.#chunkHandlers.set(sessionKey, handlers);
    void this.ensureChanSubscribed(sessionKey);
    return () => {
      handlers.delete(handler);
      if (handlers.size > 0) return;
      this.#chunkHandlers.delete(sessionKey);
      // 最后一个订阅者离开才退订频道，避免反复 subscribe/unsubscribe 抖动；
      // 迟到消息因无 handler 而自然丢弃，不影响正确性。
      void this.subscriber()
        .then((s) => s.unsubscribe(CHUNKS_CHAN(sessionKey)))
        .catch(() => {});
    };
  }

  async publishAbort(sessionKey: string, reason: AbortReason): Promise<void> {
    const c = await this.client();
    await c.publish(CONTROL_CHAN, JSON.stringify({ k: sessionKey, r: reason }));
  }

  subscribeAbort(
    onAbort: (sessionKey: string, reason: AbortReason) => void
  ): () => void {
    this.#controlHandlers.add(onAbort);
    if (!this.#controlSubscribed) {
      this.#controlSubscribed = true;
      void this.subscriber()
        .then((s) => s.subscribe(CONTROL_CHAN))
        .catch(() => {
          this.#controlSubscribed = false;
        });
    }
    return () => {
      this.#controlHandlers.delete(onAbort);
    };
  }

  async refreshLease(
    sessionKey: string,
    ownerInstanceId: string,
    ttlMs: number
  ): Promise<void> {
    const c = await this.client();
    // 任务已终态（含被清扫器回收）后不再续租，避免心跳把 error 记录的 30s 清理无限推远
    if ((await c.hget(TASK_KEY(sessionKey), "status")) !== "running") return;
    await c.set(
      LEASE_KEY(sessionKey),
      ownerInstanceId,
      "EX",
      Math.max(1, Math.ceil(ttlMs / 1000))
    );
    await c.expire(TASK_KEY(sessionKey), RUNNING_TTL_SECONDS);
    await c.expire(CHUNKS_KEY(sessionKey), RUNNING_TTL_SECONDS);
  }

  /**
   * 清扫器：回收租约失踪的 running 任务。多实例同时扫是幂等的
   * （重复 setStatus 同值 / SREM 幂等 / 关闭广播的订阅方收尾幂等）。
   * 返回本次回收的 sessionKey 列表。
   */
  async sweepOrphans(
    isAlive: (ownerInstanceId: string, sessionKey: string) => Promise<boolean>
  ): Promise<string[]> {
    const c = await this.client();
    const members = await c.smembers(RUNNING_SET);
    const reclaimed: string[] = [];
    for (const sessionKey of members) {
      const snapshot = this.decodeSnapshot(await c.hgetall(TASK_KEY(sessionKey)));
      if (!snapshot || snapshot.status !== "running") {
        // 对账：任务已终态/消失但 running 成员残留（终态 SREM 漏跑的自愈路径）
        await c.srem(RUNNING_SET, sessionKey);
        continue;
      }
      // 租约存在即视为 owner 存活（存在性判定；值的代际更替由 owner 心跳覆盖）
      if ((await c.get(LEASE_KEY(sessionKey))) !== null) continue;
      // 租约失踪：本实例能证明 owner 存活（同实例）才放过，否则诚实回收——
      // provider 流已死，假装可续是欺骗；不做任务接管迁移。
      if (await isAlive(snapshot.ownerInstanceId, sessionKey)) continue;
      await this.setStatus(sessionKey, "error", OWNER_LOST_ERROR_MESSAGE);
      reclaimed.push(sessionKey);
    }
    return reclaimed;
  }

  private async ensureChanSubscribed(sessionKey: string): Promise<void> {
    try {
      const s = await this.subscriber();
      await s.subscribe(CHUNKS_CHAN(sessionKey));
    } catch {
      // 订阅失败时保留 handler：下次订阅或重连路径重试
    }
  }

  private dispatch(channel: string, message: string): void {
    if (channel === CONTROL_CHAN) {
      let parsed: { k?: unknown; r?: unknown };
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (typeof parsed.k !== "string" || typeof parsed.r !== "string") return;
      for (const handler of [...this.#controlHandlers]) {
        try {
          handler(parsed.k, parsed.r as AbortReason);
        } catch { /* 单个订阅者异常不拖垮其余分发 */ }
      }
      return;
    }
    if (!channel.startsWith(CHUNKS_CHAN_PREFIX)) return;
    const sessionKey = channel.slice(CHUNKS_CHAN_PREFIX.length);
    const handlers = this.#chunkHandlers.get(sessionKey);
    if (!handlers || handlers.size === 0) return;
    let parsed: { t?: unknown; s?: unknown; d?: unknown; st?: unknown; m?: unknown };
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (parsed.t === "c" && typeof parsed.s === "number" && typeof parsed.d === "string") {
      const chunk = new Uint8Array(Buffer.from(parsed.d, "base64"));
      for (const handler of [...handlers]) {
        try {
          handler.onChunk(chunk, parsed.s);
        } catch { /* 单个订阅者异常不拖垮其余分发 */ }
      }
    } else if (
      parsed.t === "e" &&
      (parsed.st === "completed" || parsed.st === "error")
    ) {
      for (const handler of [...handlers]) {
        try {
          handler.onClose?.(parsed.st, typeof parsed.m === "string" ? parsed.m : undefined);
        } catch { /* 单个订阅者异常不拖垮其余分发 */ }
      }
    }
  }

  private encodeSnapshot(snapshot: TaskSnapshot): Record<string, string> {
    return {
      sessionKey: snapshot.sessionKey,
      ...(snapshot.runId === undefined ? {} : { runId: snapshot.runId }),
      ownerInstanceId: snapshot.ownerInstanceId,
      status: snapshot.status,
      ...(snapshot.errorMessage === undefined ? {} : { errorMessage: snapshot.errorMessage }),
      createdAt: String(snapshot.createdAt),
      updatedAt: String(snapshot.updatedAt),
    };
  }

  private decodeSnapshot(raw: Record<string, string>): TaskSnapshot | undefined {
    if (!raw.sessionKey || !raw.status) return undefined;
    if (
      raw.status !== "running" &&
      raw.status !== "completed" &&
      raw.status !== "error"
    ) {
      return undefined;
    }
    return {
      sessionKey: raw.sessionKey,
      runId: raw.runId || undefined,
      ownerInstanceId: raw.ownerInstanceId ?? "",
      status: raw.status,
      errorMessage: raw.errorMessage || undefined,
      createdAt: Number(raw.createdAt) || 0,
      updatedAt: Number(raw.updatedAt) || 0,
    };
  }
}
