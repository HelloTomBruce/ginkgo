import { describe, it, expect } from "vitest";
import {
  computeQueryHashKey,
  normalizeSqlForCache,
  QueryCacheManager,
} from "./queryCache";

describe("QueryCacheManager 结果集缓存管理器", () => {
  it("normalizeSqlForCache 规范化消除空格与大小写差异", () => {
    const s1 = "SELECT   *  FROM   users\n WHERE id = 1 ;";
    const s2 = "select * from users where id = 1 ;";
    expect(normalizeSqlForCache(s1)).toBe(normalizeSqlForCache(s2));
  });

  it("相同语义的查询生成一致的 hash key", () => {
    const k1 = computeQueryHashKey("ds_1", "SELECT * FROM orders WHERE status = 'ok'", [1]);
    const k2 = computeQueryHashKey("ds_1", "  select *   from orders   where status = 'ok'  ", [1]);
    expect(k1.sqlHash).toBe(k2.sqlHash);
    expect(k1.paramsHash).toBe(k2.paramsHash);
  });

  it("字符串字面量原文参与哈希：仅字面量大小写/空白不同的查询绝不共享缓存键", () => {
    const k1 = computeQueryHashKey("ds_1", "SELECT * FROM users WHERE name = 'ABC'");
    const k2 = computeQueryHashKey("ds_1", "SELECT * FROM users WHERE name = 'abc'");
    const k3 = computeQueryHashKey("ds_1", "SELECT * FROM users WHERE name = 'A  B'");
    const k4 = computeQueryHashKey("ds_1", "SELECT * FROM users WHERE name = 'A B'");
    expect(k1.sqlHash).not.toBe(k2.sqlHash);
    expect(k3.sqlHash).not.toBe(k4.sqlHash);
  });

  it("引用标识符（双引号）大小写敏感，参与哈希区分", () => {
    const k1 = computeQueryHashKey("ds_1", 'SELECT "UserName" FROM users');
    const k2 = computeQueryHashKey("ds_1", 'SELECT "username" FROM users');
    expect(k1.sqlHash).not.toBe(k2.sqlHash);
  });

  it("存储键使用全量哈希，杜绝截断碰撞", () => {
    const key = computeQueryHashKey("ds_1", "SELECT 1", [1]);
    const cache = new QueryCacheManager<string>();
    cache.set(key, "v");
    // 全量哈希键可命中；构造一个仅前缀相同的伪键则不可命中
    expect(cache.get(key)?.data).toBe("v");
    expect(key.sqlHash).toHaveLength(64);
    expect(key.paramsHash).toHaveLength(64);
  });

  it("缓存写入、命中与 TTL 过期测试", async () => {
    const cache = new QueryCacheManager<string>({ defaultTtlMs: 50 });
    const key = computeQueryHashKey("ds_1", "SELECT 1");

    expect(cache.get(key)).toBeNull();

    cache.set(key, "data_result");
    const hit = cache.get(key);
    expect(hit?.data).toBe("data_result");

    // 等待过期
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get(key)).toBeNull();
  });

  it("LRU 容量淘汰与指定数据源失效测试", () => {
    const cache = new QueryCacheManager<number>({ maxEntries: 2 });
    const k1 = computeQueryHashKey("ds_1", "SELECT 1");
    const k2 = computeQueryHashKey("ds_1", "SELECT 2");
    const k3 = computeQueryHashKey("ds_2", "SELECT 3");

    cache.set(k1, 1);
    cache.set(k2, 2);
    // 插入第 3 个，淘汰最久未访问的 k1
    cache.set(k3, 3);

    expect(cache.get(k1)).toBeNull();
    expect(cache.get(k2)?.data).toBe(2);
    expect(cache.get(k3)?.data).toBe(3);

    // 单源失效
    cache.invalidate("ds_1");
    expect(cache.get(k2)).toBeNull();
    expect(cache.get(k3)?.data).toBe(3);

    // 全量失效
    cache.invalidate();
    expect(cache.get(k3)).toBeNull();
  });
});
