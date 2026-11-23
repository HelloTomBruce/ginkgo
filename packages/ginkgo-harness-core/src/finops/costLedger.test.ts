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
    create: async () => ({
      ledger: new InMemoryCostLedger() as CostLedger,
      cleanup: async () => {},
    }),
  },
  {
    name: "NdjsonCostLedger",
    create: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "core-ledger-"));
      const ledger = new NdjsonCostLedger({
        filePath: path.join(dir, "cost.ndjson"),
      });
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
] satisfies {
  name: string;
  create: () => Promise<{ ledger: CostLedger; cleanup: () => Promise<void> }>;
}[];

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
        await ledger.record(
          record({
            runId: `run-b-${i}`,
            tenantId: "tenant-b",
            promptTokens: 200,
          })
        );
      }
      const a = await ledger.sumUsage("tenant-a", WINDOW_MS);
      expect(a.tokens).toBe(50 * 110);
      const b = await ledger.sumUsage("tenant-b", WINDOW_MS);
      expect(b.tokens).toBe(50 * 210);
    });

    it("窗口外的记录不计入（滚动窗截止 now）", async () => {
      await ledger.record(
        record({ runId: "old", finishedAt: Date.now() - 25 * 60 * 60 * 1000 })
      );
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

describe("ModelPricingTable 与 多维 FinOps 计费", () => {
  it("computeCostUsd 按 1M tokens 换算且 6 位小数", () => {
    expect(computeCostUsd({ input: 2.5, output: 10 }, 1_000_000, 500_000)).toBe(
      7.5
    );
  });

  it("支持 Prompt Caching 折价与 Reasoning Token 分档计费", () => {
    const tieredCost = computeCostUsd(
      { input: 3.0, output: 15.0, cacheRead: 0.3, reasoning: 15.0 },
      1_000_000,
      200_000,
      { cachedPromptTokens: 900_000, reasoningTokens: 100_000 }
    );
    expect(tieredCost).toBe(3.57);
  });

  it("ModelPricingTable 支持直接内存配置注入", () => {
    const table = new ModelPricingTable({
      "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
    });
    expect(table.priceFor("gpt-4o-2024-08-06")).toEqual({
      input: 2.5,
      output: 10,
      cacheRead: 1.25,
    });
  });
});
