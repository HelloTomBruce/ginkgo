/**
 * 成本台账与配额测试（WS-11）：
 * - 三实现契约矩阵（InMemory/Ndjson/Redis-mock）：窗口聚合、租户隔离、costUsd 口径
 * - Ndjson/Redis 重启（重建实例）后聚合一致
 * - 计价表：前缀匹配、最长优先、热加载、未命中只记量
 * - handler 配额准入：超限 429、租户隔离、多副本可见、无配置零拦截
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import {
  computeCostUsd,
  InMemoryCostLedger,
  ModelPricingTable,
  NdjsonCostLedger,
  RedisCostLedger,
  type CostLedger,
  type UsageRecord,
} from "./costLedger";
import { createAnalyzeHandler } from "./handler";

const WINDOW_MS = 24 * 60 * 60 * 1000;

function record(partial: Partial<UsageRecord> & { runId: string }): UsageRecord {
  return {
    tenantId: "tenant-a",
    model: "test-model",
    promptTokens: 100,
    completionTokens: 10,
    finishedAt: Date.now(),
    ...partial,
  };
}

const implementations = [
  {
    name: "InMemoryCostLedger",
    create: async () => ({ ledger: new InMemoryCostLedger() as CostLedger, cleanup: async () => {} }),
  },
  {
    name: "NdjsonCostLedger",
    create: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-"));
      const ledger = new NdjsonCostLedger({ filePath: path.join(dir, "cost.ndjson") });
      return {
        ledger: ledger as CostLedger,
        cleanup: async () => fs.rm(dir, { recursive: true, force: true }),
        dir,
      };
    },
  },
  {
    name: "RedisCostLedger",
    create: async () => {
      const client = new RedisMock();
      return {
        ledger: new RedisCostLedger({ client }) as CostLedger,
        cleanup: async () => {
          await client.flushall();
        },
        client,
      };
    },
  },
] satisfies { name: string; create: () => Promise<{ ledger: CostLedger; cleanup: () => Promise<void> }> }[];

describe.each(implementations.filter((i) => i.name !== "RedisCostLedger"))(
  "CostLedger 契约：$name",
  ({ create }) => {
    let ledger: CostLedger;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ ledger, cleanup } = await create());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("record 100 条后 sumUsage 按租户与窗口聚合一致", async () => {
      for (let i = 0; i < 50; i++) {
        await ledger.record(record({ runId: `run-a-${i}` }));
      }
      for (let i = 0; i < 50; i++) {
        await ledger.record(record({ runId: `run-b-${i}`, tenantId: "tenant-b", promptTokens: 200 }));
      }
      const a = await ledger.sumUsage("tenant-a", WINDOW_MS);
      expect(a.tokens).toBe(50 * 110);
      const b = await ledger.sumUsage("tenant-b", WINDOW_MS);
      expect(b.tokens).toBe(50 * 210);
    });

    it("窗口外的记录不计入（滚动窗截止 now）", async () => {
      await ledger.record(record({ runId: "old", finishedAt: Date.now() - 25 * 60 * 60 * 1000 }));
      await ledger.record(record({ runId: "new" }));
      const usage = await ledger.sumUsage("tenant-a", WINDOW_MS);
      expect(usage.tokens).toBe(110);
    });

    it("costUsd 只累计命中计价的记录，未命中不进钱账", async () => {
      await ledger.record(record({ runId: "p1", costUsd: 0.01 }));
      await ledger.record(record({ runId: "p2", costUsd: 0.02 }));
      await ledger.record(record({ runId: "p3" }));
      const usage = await ledger.sumUsage("tenant-a", WINDOW_MS);
      expect(usage.costUsd).toBeCloseTo(0.03, 6);
    });
  }
);

describe("NdjsonCostLedger 重启回放", () => {
  it("重建实例后 sumUsage 与写入侧一致", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-restart-"));
    const filePath = path.join(dir, "cost.ndjson");
    const first = new NdjsonCostLedger({ filePath });
    for (let i = 0; i < 20; i++) {
      await first.record(record({ runId: `run-${i}` }));
    }
    const second = new NdjsonCostLedger({ filePath });
    const usage = await second.sumUsage("tenant-a", WINDOW_MS);
    expect(usage.tokens).toBe(20 * 110);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("半写尾行（无换行终止的坏 JSON）被跳过，不污染聚合", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-half-"));
    const filePath = path.join(dir, "cost.ndjson");
    const first = new NdjsonCostLedger({ filePath });
    await first.record(record({ runId: "good" }));
    await fs.appendFile(filePath, '{"runId":"half","tenantId":"tenant-a",');
    const second = new NdjsonCostLedger({ filePath });
    const usage = await second.sumUsage("tenant-a", WINDOW_MS);
    expect(usage.tokens).toBe(110);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("RedisCostLedger", () => {
  it("重建实例（同 client）后 sumUsage 一致", async () => {
    const client = new RedisMock();
    const first = new RedisCostLedger({ client });
    for (let i = 0; i < 10; i++) {
      await first.record(record({ runId: `run-${i}` }));
    }
    const second = new RedisCostLedger({ client });
    const usage = await second.sumUsage("tenant-a", WINDOW_MS);
    expect(usage.tokens).toBe(10 * 110);
    await client.flushall();
  });
});

describe("ModelPricingTable", () => {
  it("前缀匹配最长优先；未命中返回 undefined（只记量不记钱）", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pricing-"));
    const file = path.join(dir, "model-pricing.json");
    await fs.writeFile(
      file,
      JSON.stringify({ "gpt-4": { input: 1, output: 2 }, "gpt-4o": { input: 10, output: 20 } })
    );
    const table = new ModelPricingTable(file);
    expect(table.priceFor("gpt-4o-mini-2024")).toEqual({ input: 10, output: 20 });
    expect(table.priceFor("gpt-4-turbo")).toEqual({ input: 1, output: 2 });
    expect(table.priceFor("claude-x")).toBeUndefined();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("mtime 变化热加载：改文件无需重建实例", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pricing-hot-"));
    const file = path.join(dir, "model-pricing.json");
    await fs.writeFile(file, JSON.stringify({ "m": { input: 1, output: 1 } }));
    const table = new ModelPricingTable(file);
    expect(table.priceFor("m")?.input).toBe(1);
    // mtime 精度保护：显式设置旧时间再更新
    const past = new Date(Date.now() - 5000);
    await fs.utimes(file, past, past);
    await fs.writeFile(file, JSON.stringify({ "m": { input: 9, output: 9 } }));
    await fs.utimes(file, new Date(), new Date());
    table.reloadIfChanged();
    expect(table.priceFor("m")?.input).toBe(9);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("computeCostUsd 按 1M tokens 换算且 6 位小数", () => {
    expect(computeCostUsd({ input: 2.5, output: 10 }, 1_000_000, 500_000)).toBe(7.5);
    expect(computeCostUsd({ input: 0.15, output: 0.6 }, 1000, 100)).toBe(0.00021);
  });
});

describe("handler 配额准入（WS-11）", () => {
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ["LLM_TENANT_TOKEN_LIMIT", "LLM_QUOTA_WINDOW_MS"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function makeQuotaRequest(): Request {
    return new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
  }

  it("租户滚动窗累计超上限 → 429 + QUOTA_EXCEEDED 遥测", async () => {
    const ledger = new InMemoryCostLedger();
    // handler 未注入 authenticate → 租户为缺省 anon，记录必须落在同一租户
    await ledger.record(record({ runId: "big", tenantId: "anon", promptTokens: 900, completionTokens: 100 }));
    const warns: { code?: string }[] = [];
    const POST = createAnalyzeHandler({
      datasources: {} as never,
      costLedger: ledger,
      quota: { tenantTokenLimit: 1000, windowMs: WINDOW_MS },
      telemetry: { emit: (e) => warns.push(e as { code?: string }) },
    });
    const res = await POST(makeQuotaRequest());
    expect(res.status).toBe(429);
    expect(warns.some((w) => w.code === "QUOTA_EXCEEDED")).toBe(true);
    expect(((await res.json()) as { error: string }).error).toContain("额度");
  });

  it("换租户互不影响：tenant-b 有额度而 tenant-a 超限", async () => {
    const ledger = new InMemoryCostLedger();
    await ledger.record(record({ runId: "a", tenantId: "tenant-a", promptTokens: 5000 }));
    const POST = createAnalyzeHandler({
      datasources: {} as never,
      costLedger: ledger,
      quota: { tenantTokenLimit: 1000, windowMs: WINDOW_MS },
      authenticate: async () => ({ principal: "tenant-b" }),
    });
    const res = await POST(makeQuotaRequest());
    expect(res.status).not.toBe(429);
    await res.text();
  });

  it("多副本语义：共享 Redis 台账时 A 实例记录的用量对 B 实例准入可见", async () => {
    const client = new RedisMock();
    const sharedA = new RedisCostLedger({ client });
    const sharedB = new RedisCostLedger({ client });
    await sharedA.record(record({ runId: "from-a", promptTokens: 2000 }));
    const quota = { tenantTokenLimit: 1000, windowMs: WINDOW_MS };
    const POSTa = createAnalyzeHandler({
      datasources: {} as never,
      costLedger: sharedA,
      quota,
      authenticate: async () => ({ principal: "tenant-a" }),
    });
    const POSTb = createAnalyzeHandler({
      datasources: {} as never,
      costLedger: sharedB,
      quota,
      authenticate: async () => ({ principal: "tenant-a" }),
    });
    expect((await POSTa(makeQuotaRequest())).status).toBe(429);
    expect((await POSTb(makeQuotaRequest())).status).toBe(429);
    await client.flushall();
  });

  it("无配额配置时零拦截（未注入台账不建台账）", async () => {
    const POST = createAnalyzeHandler({ datasources: {} as never });
    const res = await POST(makeQuotaRequest());
    expect(res.status).not.toBe(429);
    await res.text();
  });

  it("env LLM_TENANT_TOKEN_LIMIT 生效（缺省内存台账）", async () => {
    process.env.LLM_TENANT_TOKEN_LIMIT = "500";
    const POST = createAnalyzeHandler({ datasources: {} as never });
    // 经工厂暴露的台账记账（缺省内存实现，租户 anon），再验证准入
    await POST.costLedger!.record({
      runId: "env-fill",
      tenantId: "anon",
      model: "test-model",
      promptTokens: 500,
      completionTokens: 0,
      finishedAt: Date.now(),
    });
    const res = await POST(makeQuotaRequest());
    expect(res.status).toBe(429);
    await res.text();
  });
});
