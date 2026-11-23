import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CertifiedQueryStore } from "./certifiedStore";
import type { CertifiedQuery } from "./types";

describe("CertifiedQueryStore 认证查询知识库", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-store-test-"));
    tmpFile = path.join(tmpDir, "certified-queries.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleQuery: CertifiedQuery = {
    id: "cq_cac",
    sourceId: "pg_marketing",
    title: "渠道获客成本 CAC",
    description: "按渠道统计客户获取成本",
    businessMetricFormula: "CAC = 营销总花费 / 成交客户数",
    sqlTemplate: "SELECT channel, SUM(spend)/COUNT(DISTINCT user_id) AS cac FROM ads GROUP BY channel",
    tags: ["CAC", "获客", "渠道"],
  };

  it("支持内存初始化与增删查改", () => {
    const store = new CertifiedQueryStore({ initialQueries: [sampleQuery] });
    expect(store.size()).toBe(1);
    expect(store.get("cq_cac")?.title).toBe("渠道获客成本 CAC");

    // 筛选数据源
    expect(store.list("pg_marketing")).toHaveLength(1);
    expect(store.list("other_db")).toHaveLength(0);

    // 删除
    expect(store.delete("cq_cac")).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("支持基于文件的持久化写入与读取", () => {
    const store1 = new CertifiedQueryStore({ configPath: tmpFile });
    store1.upsert(sampleQuery);

    expect(fs.existsSync(tmpFile)).toBe(true);

    // store2 从相同文件恢复
    const store2 = new CertifiedQueryStore({ configPath: tmpFile });
    expect(store2.size()).toBe(1);
    expect(store2.get("cq_cac")?.businessMetricFormula).toContain("营销总花费");
  });

  it("reloadIfChanged：配置文件变更后热加载，未变更时保持现状", async () => {
    const store = new CertifiedQueryStore({ configPath: tmpFile });
    expect(store.size()).toBe(0);

    // 外部写入配置
    fs.writeFileSync(tmpFile, JSON.stringify([sampleQuery]), "utf-8");
    // 确保 mtime 变化（部分文件系统精度为秒级）
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(tmpFile, future, future);

    store.reloadIfChanged();
    expect(store.size()).toBe(1);
    expect(store.get("cq_cac")).toBeDefined();

    // 未变更时重复调用无副作用
    store.reloadIfChanged();
    expect(store.size()).toBe(1);

    // 文件被删除时保持现状，不抛错
    fs.rmSync(tmpFile);
    expect(() => store.reloadIfChanged()).not.toThrow();
    expect(store.size()).toBe(1);
  });
});
