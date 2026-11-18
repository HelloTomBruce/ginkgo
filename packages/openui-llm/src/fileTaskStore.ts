import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AbortReason } from "./telemetry";
import type { TaskSnapshot, TaskStatus, TaskStore } from "./taskStore";

const TERMINAL_RETENTION_MS = 30_000;

/**
 * 进程重启恢复标记：File 后端加载时把遗留 running 任务转为该 error 消息。
 * createResponse 据此区分「先重放历史再抛错」的恢复语义与自然 error 的原有消费结果；
 * 定义在此且不从 taskStore 导入值，是为了让裸 Node 子进程（--experimental-strip-types）
 * 能直接加载本文件——无扩展名的本地值导入在裸 ESM 下无法解析。
 */
export const PROCESS_RESTART_ERROR_MESSAGE = "process_restart";

interface FileTaskRecord {
  snapshot: TaskSnapshot;
  chunks: Uint8Array[];
}

export interface FileTaskStoreOptions {
  /** NDJSON 根目录；调用方负责解析 LLM_TASK_STORE_DIR 并注入 */
  dir: string;
}

/**
 * 单机文件实现：首行是 TaskSnapshot JSON，后续每行保存一个 base64 分块。
 * 首次实际操作时才扫描目录恢复，构造与模块加载均不同步读盘。
 */
export class FileTaskStore implements TaskStore {
  private readonly dir: string;
  private readonly tasks = new Map<string, FileTaskRecord>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 同 key 的文件写入排队尾部：append 与元数据 rename 不得交错 */
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly events = new EventEmitter();
  private loading?: Promise<void>;

  constructor(opts: FileTaskStoreOptions) {
    this.dir = path.resolve(opts.dir);
    this.events.setMaxListeners(0);
  }

  async create(snapshot: TaskSnapshot): Promise<void> {
    await this.ensureLoaded();
    this.clearCleanup(snapshot.sessionKey);
    const record: FileTaskRecord = { snapshot: { ...snapshot }, chunks: [] };
    this.tasks.set(snapshot.sessionKey, record);
    await fs.mkdir(this.dir, { recursive: true });
    await this.enqueueWrite(snapshot.sessionKey, () => this.persist(record));
  }

  async appendChunk(sessionKey: string, chunk: Uint8Array): Promise<void> {
    await this.ensureLoaded();
    const record = this.tasks.get(sessionKey);
    if (!record) return;
    await fs.mkdir(this.dir, { recursive: true });
    await this.enqueueWrite(sessionKey, async () => {
      // 排队期间记录可能已被删除或替换为新任务：旧任务的迟到写入不得落盘。
      if (this.tasks.get(sessionKey) !== record) return;
      await fs.appendFile(this.filePath(sessionKey), `${Buffer.from(chunk).toString("base64")}\n`);
      record.chunks.push(chunk);
      this.events.emit(this.chunkEvent(sessionKey), chunk);
    });
  }

  async setStatus(
    sessionKey: string,
    status: TaskStatus,
    errorMessage?: string
  ): Promise<void> {
    await this.ensureLoaded();
    const record = this.tasks.get(sessionKey);
    if (!record) return;
    record.snapshot = {
      ...record.snapshot,
      status,
      updatedAt: Date.now(),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
    await this.enqueueWrite(sessionKey, async () => {
      if (this.tasks.get(sessionKey) !== record) return;
      await this.persist(record);
    });
    if (status !== "running") this.scheduleCleanup(sessionKey);
  }

  async get(sessionKey: string): Promise<TaskSnapshot | undefined> {
    await this.ensureLoaded();
    const snapshot = this.tasks.get(sessionKey)?.snapshot;
    return snapshot ? { ...snapshot } : undefined;
  }

  async getChunks(sessionKey: string): Promise<Uint8Array[]> {
    await this.ensureLoaded();
    return [...(this.tasks.get(sessionKey)?.chunks ?? [])];
  }

  async delete(sessionKey: string): Promise<void> {
    await this.ensureLoaded();
    this.clearCleanup(sessionKey);
    this.tasks.delete(sessionKey);
    await this.enqueueWrite(sessionKey, () => fs.rm(this.filePath(sessionKey), { force: true }));
  }

  async runningCount(): Promise<number> {
    await this.ensureLoaded();
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

  /** 单进程文件后端不需要分布式租约。 */
  async refreshLease(): Promise<void> {}

  /** 文件后端不跨副本，running 恢复已在加载时转为 process_restart。 */
  async sweepOrphans(): Promise<string[]> {
    return [];
  }

  private ensureLoaded(): Promise<void> {
    this.loading ??= this.restore();
    return this.loading;
  }

  /** 同 key 的文件写入排队执行：旧任务的 append 不会与新任务的 rename/rm 交错。 */
  private enqueueWrite(sessionKey: string, write: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(sessionKey) ?? Promise.resolve();
    const run = previous.then(write, write);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.writeQueues.set(sessionKey, tail);
    void tail.then(() => {
      // 队列已排空且无后续写入续接时回收条目，避免 Map 无限增长。
      if (this.writeQueues.get(sessionKey) === tail) this.writeQueues.delete(sessionKey);
    });
    return run;
  }

  /** 懒恢复：completed/error 可重放；异常退出遗留的 running 不得伪装为仍在运行。 */
  private async restore(): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const file of files) {
      if (!file.endsWith(".ndjson")) continue;
      const filePath = path.join(this.dir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        // 崩溃可能截断正在写入的尾行：未以换行终止的最后一行不可信，整行丢弃。
        const terminated = content.endsWith("\n")
          ? content
          : content.slice(0, content.lastIndexOf("\n") + 1);
        const lines = terminated.split("\n");
        const snapshot = JSON.parse(lines[0]) as TaskSnapshot;
        if (!snapshot.sessionKey || snapshot.ownerInstanceId === undefined) continue;
        const record: FileTaskRecord = {
          snapshot,
          chunks: lines.slice(1).flatMap((line) => {
            if (line.length === 0) return [];
            const decoded = Buffer.from(line, "base64");
            // canonical base64 校验：半写/损坏行解码后无法还原自身编码，丢弃。
            return decoded.toString("base64") === line ? [new Uint8Array(decoded)] : [];
          }),
        };
        if (snapshot.status === "running") {
          record.snapshot = {
            ...snapshot,
            status: "error",
            errorMessage: PROCESS_RESTART_ERROR_MESSAGE,
            updatedAt: Date.now(),
          };
          await this.persist(record);
        }
        this.tasks.set(snapshot.sessionKey, record);
        if (record.snapshot.status !== "running") {
          this.scheduleCleanup(snapshot.sessionKey);
        }
      } catch {
        // 单个损坏/半写文件不阻断其余任务恢复；该文件保留供运维排查。
      }
    }
  }

  /** 原子重写元数据与既有分块，避免状态更新崩溃留下半行首行。 */
  private async persist(record: FileTaskRecord): Promise<void> {
    const filePath = this.filePath(record.snapshot.sessionKey);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const lines = [
      JSON.stringify(record.snapshot),
      ...record.chunks.map((chunk) => Buffer.from(chunk).toString("base64")),
    ];
    await fs.writeFile(tempPath, `${lines.join("\n")}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  }

  private scheduleCleanup(sessionKey: string): void {
    this.clearCleanup(sessionKey);
    const snapshot = this.tasks.get(sessionKey)?.snapshot;
    if (!snapshot) return;
    const remaining = Math.max(
      0,
      TERMINAL_RETENTION_MS - (Date.now() - snapshot.updatedAt)
    );
    const timer = setTimeout(
      () => this.delete(sessionKey).catch(() => {}),
      remaining
    );
    this.cleanupTimers.set(sessionKey, timer);
    const unref = timer as { unref?: () => void };
    if (typeof unref === "object" && unref !== null && typeof unref.unref === "function") {
      unref.unref();
    }
  }

  private clearCleanup(sessionKey: string): void {
    const timer = this.cleanupTimers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.cleanupTimers.delete(sessionKey);
  }

  private filePath(sessionKey: string): string {
    // sessionKey 含租户分隔符，且外部 sessionId 可能含路径字符；编码后限制在配置目录内。
    return path.join(this.dir, `${encodeURIComponent(sessionKey)}.ndjson`);
  }

  private chunkEvent(sessionKey: string): string {
    return `chunk:${sessionKey}`;
  }
}
