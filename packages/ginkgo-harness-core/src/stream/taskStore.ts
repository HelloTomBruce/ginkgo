import { EventEmitter } from "node:events";
import type { AbortReason } from "../telemetry/telemetry";

export type TaskStatus = "running" | "completed" | "error";

export interface TaskSnapshot {
  /** 已含租户前缀的会话存储键（WS-10） */
  sessionKey: string;
  runId?: string;
  /** 创建任务的实例；多副本孤儿回收依此判定归属 */
  ownerInstanceId: string;
  status: TaskStatus;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStore {
  /**
   * 多副本语义声明：仅实现了真实分布式租约/清扫（如 Redis 后端）时置 true。
   * hub 据此决定是否启动孤儿清扫器；单机实现（内存/文件）不声明，
   * 清扫器不启动，其 no-op sweepOrphans 仅保留接口兼容。
   */
  readonly multiReplica?: boolean;
  create(snapshot: TaskSnapshot): Promise<void>;
  appendChunk(sessionKey: string, chunk: Uint8Array): Promise<void>;
  setStatus(sessionKey: string, status: TaskStatus, errorMessage?: string): Promise<void>;
  get(sessionKey: string): Promise<TaskSnapshot | undefined>;
  getChunks(sessionKey: string): Promise<Uint8Array[]>;
  delete(sessionKey: string): Promise<void>;
  /** 分布式准入计数 */
  runningCount(): Promise<number>;
  /**
   * live 分块订阅（重连续接）与 abort 广播；内存实现为进程内 EventEmitter。
   * - onChunk 第二参 seq 为分块序号（1 起，等于该任务已提交分块总数）：重连方按
   *   「先订阅、后读重放列表」接入时，用序号去重两边都出现的分块（订阅早于列表
   *   读取的间隙分块），消掉永久丢失或双份。
   * - onClose 在任务转入终态时回调：非 owner 订阅者据此收尾流，否则会等待
   *   永不到来的 close 而悬挂。可选：单机内存订阅链路不依赖它。
   */
  subscribeChunks(
    sessionKey: string,
    onChunk: (chunk: Uint8Array, seq: number) => void,
    onClose?: (status: TaskStatus, errorMessage?: string) => void
  ): () => void;
  publishAbort(sessionKey: string, reason: AbortReason): Promise<void>;
  subscribeAbort(
    onAbort: (sessionKey: string, reason: AbortReason) => void
  ): () => void;
  /**
   * 租约：多副本实现必须；单机实现为 no-op。
   * owner 注册任务后立即续一次（冷启动窗口），此后按 TTL/3 周期刷新。
   */
  refreshLease?(sessionKey: string, ownerInstanceId: string, ttlMs: number): Promise<void>;
  /** 清扫器：回收租约失踪的 running 任务；多副本实现必须，单机实现为 no-op */
  sweepOrphans?(
    isAlive: (ownerInstanceId: string, sessionKey: string) => Promise<boolean>
  ): Promise<string[]>;
}

interface MemoryTaskRecord {
  snapshot: TaskSnapshot;
  chunks: Uint8Array[];
}

/** 缺省单机实现：共享任务状态保存在进程内 Map，订阅经进程内 EventEmitter 广播。 */
export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, MemoryTaskRecord>();
  private readonly events = new EventEmitter();

  constructor() {
    // 一个会话可有多个重连订阅者；进程内广播无需 Node 默认的 10 listener 限制。
    this.events.setMaxListeners(0);
  }

  async create(snapshot: TaskSnapshot): Promise<void> {
    this.tasks.set(snapshot.sessionKey, {
      snapshot: { ...snapshot },
      chunks: [],
    });
  }

  async appendChunk(sessionKey: string, chunk: Uint8Array): Promise<void> {
    const record = this.tasks.get(sessionKey);
    if (!record) return;
    record.chunks.push(chunk);
    // 分块序号 = 提交后列表长度（与 RPUSH 返回值同语义），重连方依此去重
    this.events.emit(this.chunkEvent(sessionKey), chunk, record.chunks.length);
  }

  async setStatus(
    sessionKey: string,
    status: TaskStatus,
    errorMessage?: string
  ): Promise<void> {
    const record = this.tasks.get(sessionKey);
    if (!record) return;
    const previous = record.snapshot.status;
    record.snapshot = {
      ...record.snapshot,
      status,
      updatedAt: Date.now(),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
    // running→终态时广播关闭：非 owner 订阅者（重连续接方）据此收尾，不再等永不到来的分块
    if (status !== "running" && previous === "running") {
      this.events.emit(this.closeEvent(sessionKey), status, errorMessage);
    }
  }

  async get(sessionKey: string): Promise<TaskSnapshot | undefined> {
    const snapshot = this.tasks.get(sessionKey)?.snapshot;
    return snapshot ? { ...snapshot } : undefined;
  }

  async getChunks(sessionKey: string): Promise<Uint8Array[]> {
    return [...(this.tasks.get(sessionKey)?.chunks ?? [])];
  }

  async delete(sessionKey: string): Promise<void> {
    this.tasks.delete(sessionKey);
  }

  async runningCount(): Promise<number> {
    let count = 0;
    for (const record of this.tasks.values()) {
      if (record.snapshot.status === "running") count++;
    }
    return count;
  }

  subscribeChunks(
    sessionKey: string,
    onChunk: (chunk: Uint8Array, seq: number) => void,
    onClose?: (status: TaskStatus, errorMessage?: string) => void
  ): () => void {
    const event = this.chunkEvent(sessionKey);
    this.events.on(event, onChunk);
    let unsubscribeClose: (() => void) | undefined;
    if (onClose) {
      const closeEvent = this.closeEvent(sessionKey);
      const closeListener = (status: TaskStatus, errorMessage?: string) =>
        onClose(status, errorMessage);
      this.events.on(closeEvent, closeListener);
      unsubscribeClose = () => this.events.off(closeEvent, closeListener);
    }
    return () => {
      this.events.off(event, onChunk);
      unsubscribeClose?.();
    };
  }

  async publishAbort(sessionKey: string, reason: AbortReason): Promise<void> {
    this.events.emit("abort", sessionKey, reason);
  }

  subscribeAbort(
    onAbort: (sessionKey: string, reason: AbortReason) => void
  ): () => void {
    this.events.on("abort", onAbort);
    return () => this.events.off("abort", onAbort);
  }

  /** 单进程不存在跨实例租约，保留完整接口供多副本后端实现。 */
  // 无参实现即可满足可选接口方法签名（TS 兼容少参方法）；单机无租约语义
  async refreshLease(): Promise<void> {}

  /** 单进程 owner 与任务同生命周期，无跨副本孤儿可扫。 */
  async sweepOrphans(): Promise<string[]> {
    return [];
  }

  private chunkEvent(sessionKey: string): string {
    return `chunk:${sessionKey}`;
  }

  private closeEvent(sessionKey: string): string {
    return `close:${sessionKey}`;
  }
}
