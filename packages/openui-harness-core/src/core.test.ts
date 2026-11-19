import { describe, it, expect } from "vitest";
import { HarnessCore } from "./core";
import { InMemoryTaskStore } from "./stream/taskStore";
import { InMemoryCostLedger } from "./finops/costLedger";

describe("HarnessCore 统一门面底座", () => {
  it("默认配置实例化 HarnessCore，各子系统正常初始化", () => {
    const harness = new HarnessCore();

    expect(harness.config.pipeline.concurrency.maxConcurrent).toBe(10);
    expect(harness.config.resilience.timeoutMs).toBe(30000);
    expect(harness.mcp).toBeDefined();
    expect(harness.streamHub).toBeDefined();
    expect(harness.taskStore).toBeInstanceOf(InMemoryTaskStore);
    expect(harness.costLedger).toBeInstanceOf(InMemoryCostLedger);
  });

  it("支持传入部分配置并正确覆盖", () => {
    const harness = new HarnessCore({
      pipeline: {
        concurrency: {
          maxConcurrent: 25,
        },
      },
      resilience: {
        timeoutMs: 15000,
      },
    });

    expect(harness.config.pipeline.concurrency.maxConcurrent).toBe(25);
    expect(harness.config.resilience.timeoutMs).toBe(15000);
    // 未覆盖的保留默认值
    expect(harness.config.resilience.maxRetries).toBe(3);
  });

  it("updateConfig 支持运行时热更新补丁", () => {
    const harness = new HarnessCore();
    expect(harness.config.pipeline.concurrency.maxConcurrent).toBe(10);

    const updated = harness.updateConfig({
      pipeline: {
        concurrency: {
          maxConcurrent: 50,
        },
      },
    });

    expect(updated.pipeline.concurrency.maxConcurrent).toBe(50);
    expect(harness.config.pipeline.concurrency.maxConcurrent).toBe(50);
  });
});
