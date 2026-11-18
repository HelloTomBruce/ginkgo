import { EventEmitter } from "node:events";
import type { AbortReason } from "./telemetry";

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
  create(snapshot: TaskSnapshot): Promise<void>;
  appendChunk(sessionKey: string, chunk: Uint8Array): Promise<void>;
  setStatus(sessionKey: string, status: TaskStatus, errorMessage?: string): Promise<void>;
  get(sessionKey: string): Promise<TaskSnapshot | undefined>;
  getChunks(sessionKey: string): Promise<Uint8Array[]>;
  delete(sessionKey: string): Promise<void>;
  /** 分布式准入计数 */
  runningCount(): Promise<number>;
  /** live 分块订阅（重连续接）与 abort 广播；内存实现为进程内 EventEmitter */
  subscribeChunks(sessionKey: string, onChunk: (chunk: Uint8Array) => void): () => void;
  publishAbort(sessionKey: string, reason: AbortReason): Promise<void>;
  subscribeAbort(
    onAbort: (sessionKey: string, reason: AbortReason) => void
  ): () => void;
  /** 租约：多副本实现必须；单机实现为 no-op */
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
    this.events.emit(this.chunkEvent(sessionKey), chunk);
  }

  async setStatus(
    sessionKey: string,
    status: TaskStatus,
    errorMessage?: string
  ): Promise<void> {
    const record = this.tasks.get(sessionKey);
    if (!record) return;
    record.snapshot = {
      ...record.snapshot,
      status,
      updatedAt: Date.now(),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
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

  subscribeChunks(sessionKey: string, onChunk: (chunk: Uint8Array) => void): () => void {
    const event = this.chunkEvent(sessionKey);
    this.events.on(event, onChunk);
    return () => this.events.off(event, onChunk);
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
  async refreshLease(): Promise<void> {}

  /** 单进程 owner 与任务同生命周期，无跨副本孤儿可扫。 */
  async sweepOrphans(): Promise<string[]> {
    return [];
  }

  private chunkEvent(sessionKey: string): string {
    return `chunk:${sessionKey}`;
  }
}
