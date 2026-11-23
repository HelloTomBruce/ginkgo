import { createHash } from "node:crypto";
import type { QueryCacheKey } from "./types";

export interface CacheEntry<T> {
  key: string;
  data: T;
  cachedAt: number;
  ttlMs: number;
}

/**
 * 规范化 SQL：折叠结构部分的多余空白与大小写，以便精确命中相同语义的 SQL。
 *
 * 正确性约束：字符串字面量（'...'）与引用标识符（"..."）的原文必须逐字保留——
 * PG 的引用标识符与所有方言的字符串字面量都是大小写敏感的，
 * 若对整串做小写/空白折叠，"WHERE name='ABC'" 与 "WHERE name='abc'"
 * 会得到相同缓存键而错配结果集（参考 sqlGuard.enforceRowLimit 的字面量剥离哲学）。
 */
export function normalizeSqlForCache(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const LITERAL_RE = /('(?:[^']|'')*'|"(?:[^"]|"")*")/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = LITERAL_RE.exec(trimmed)) !== null) {
    parts.push(trimmed.slice(last, m.index).replace(/\s+/g, " ").toLowerCase());
    parts.push(m[0]); // 字面量/引用标识符原文保留，参与哈希区分
    last = m.index + m[0].length;
  }
  parts.push(trimmed.slice(last).replace(/\s+/g, " ").toLowerCase());
  return parts.join("");
}

/**
 * 计算查询的哈希唯一指纹
 */
export function computeQueryHashKey(
  sourceId: string,
  sql: string,
  params?: unknown[]
): QueryCacheKey {
  const normSql = normalizeSqlForCache(sql);
  const sqlHash = createHash("sha256").update(normSql).digest("hex");
  const paramsHash = createHash("sha256")
    .update(JSON.stringify(params ?? []))
    .digest("hex");

  return {
    sourceId,
    sqlHash,
    paramsHash,
  };
}

/**
 * 存储键：使用全量哈希——缓存错配会返回错误结果集，截断哈希的碰撞尾部风险不可接受。
 * 日志展示请使用 formatCacheKeyDisplay。
 */
export function formatCacheKey(key: QueryCacheKey): string {
  return `${key.sourceId}:${key.sqlHash}:${key.paramsHash}`;
}

/** 日志/调试展示用的截断形态（不参与存储） */
export function formatCacheKeyDisplay(key: QueryCacheKey): string {
  return `${key.sourceId}:${key.sqlHash.slice(0, 16)}:${key.paramsHash.slice(0, 8)}`;
}

/**
 * 查询级结果集 KV 缓存管理器（带 TTL 与 LRU 淘汰）
 */
export class QueryCacheManager<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private defaultTtlMs: number;

  constructor(options?: { maxEntries?: number; defaultTtlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 500;
    this.defaultTtlMs = options?.defaultTtlMs ?? 15 * 60 * 1000; // 默认 15 分钟
  }

  get(key: QueryCacheKey): { data: T; cachedAt: number } | null {
    const formatted = formatCacheKey(key);
    const entry = this.cache.get(formatted);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(formatted);
      return null;
    }

    // LRU：刷新访问顺序
    this.cache.delete(formatted);
    this.cache.set(formatted, entry);

    return {
      data: entry.data,
      cachedAt: entry.cachedAt,
    };
  }

  set(key: QueryCacheKey, data: T, ttlMs?: number): void {
    const formatted = formatCacheKey(key);
    const now = Date.now();

    // 淘汰最久未使用的项
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(formatted, {
      key: formatted,
      data,
      cachedAt: now,
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  /**
   * 清除特定数据源或全部缓存
   */
  invalidate(sourceId?: string): void {
    if (!sourceId) {
      this.cache.clear();
      return;
    }
    const prefix = `${sourceId}:`;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }
}
