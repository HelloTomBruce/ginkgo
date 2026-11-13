import fs from "node:fs";
import path from "node:path";
import type { CertifiedQuery } from "./types";

export interface CertifiedQueryStoreOptions {
  configPath?: string;
  initialQueries?: CertifiedQuery[];
}

/**
 * Certified Queries 知识库存储器（文件持久化 + 内存快速索引）
 */
export class CertifiedQueryStore {
  private queries = new Map<string, CertifiedQuery>();
  private configPath?: string;
  private initialQueries: CertifiedQuery[] = [];
  private lastMtimeMs = 0;

  constructor(options?: CertifiedQueryStoreOptions) {
    this.configPath = options?.configPath;

    if (options?.initialQueries) {
      this.initialQueries = options.initialQueries;
      for (const q of options.initialQueries) {
        this.queries.set(q.id, q);
      }
    }

    if (this.configPath) {
      this.loadFromFile(this.configPath);
      this.touchMtime();
    }
  }

  private touchMtime(): void {
    try {
      this.lastMtimeMs = this.configPath
        ? fs.statSync(this.configPath).mtimeMs
        : 0;
    } catch {
      this.lastMtimeMs = 0;
    }
  }

  /**
   * 配置文件 mtime 热加载：文件变更后重建内存索引（含 initialQueries 垫底）。
   * 每次语义路由前调用一次（一次 stat 的成本），免去改配置必须重启进程。
   */
  reloadIfChanged(): void {
    if (!this.configPath) return;
    let mtime = 0;
    try {
      mtime = fs.statSync(this.configPath).mtimeMs;
    } catch {
      return; // 文件缺失/不可读时保持现状
    }
    if (mtime === this.lastMtimeMs) return;
    this.lastMtimeMs = mtime;
    this.queries.clear();
    for (const q of this.initialQueries) {
      this.queries.set(q.id, q);
    }
    this.loadFromFile(this.configPath);
  }

  loadFromFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.sqlTemplate) {
            this.queries.set(item.id, item);
          }
        }
      }
    } catch (err) {
      console.warn(`[CertifiedQueryStore] 加载认证查询配置失败 (${filePath}):`, err);
    }
  }

  saveToFile(filePath?: string): void {
    const target = filePath || this.configPath;
    if (!target) return;
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.queries.values());
      fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[CertifiedQueryStore] 保存认证查询配置失败 (${target}):`, err);
    }
  }

  list(sourceId?: string): CertifiedQuery[] {
    const all = Array.from(this.queries.values());
    if (!sourceId) return all;
    return all.filter((q) => q.sourceId === "*" || q.sourceId === sourceId);
  }

  get(id: string): CertifiedQuery | undefined {
    return this.queries.get(id);
  }

  upsert(query: CertifiedQuery): void {
    this.queries.set(query.id, {
      ...query,
      certifiedAt: query.certifiedAt ?? Date.now(),
    });
    if (this.configPath) {
      this.saveToFile();
    }
  }

  delete(id: string): boolean {
    const res = this.queries.delete(id);
    if (res && this.configPath) {
      this.saveToFile();
    }
    return res;
  }

  clear(): void {
    this.queries.clear();
  }

  size(): number {
    return this.queries.size;
  }
}
