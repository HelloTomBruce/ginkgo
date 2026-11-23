import {
  resolveHarnessConfig,
  type HarnessConfig,
  type ResolvedHarnessConfig,
} from "./config";
import { MCPClientManager } from "./mcp";
import { SessionStreamHub } from "./stream/streamHub";
import {
  InMemoryCostLedger,
  NdjsonCostLedger,
  RedisCostLedger,
  type CostLedger,
} from "./finops/costLedger";
import { InMemoryTaskStore, type TaskStore } from "./stream/taskStore";
import { FileTaskStore } from "./stream/fileTaskStore";
import { RedisTaskStore } from "./stream/redisTaskStore";

/**
 * HarnessCore 统一门面底座
 * 聚合分层配置、MCP Client Manager、Stream Hub 与成本台账。
 */
export class HarnessCore {
  public config: ResolvedHarnessConfig;
  public readonly mcp: MCPClientManager;
  public readonly streamHub: SessionStreamHub;
  public readonly costLedger: CostLedger;
  public readonly taskStore: TaskStore;

  constructor(
    customConfig?: HarnessConfig,
    env?: Record<string, string | undefined>
  ) {
    this.config = resolveHarnessConfig(customConfig, env);

    // 1. 依据配置装配 TaskStore
    if (this.config.stream.storeType === "redis" && this.config.stream.redisUrl) {
      this.taskStore = new RedisTaskStore({
        url: this.config.stream.redisUrl,
      });
    } else if (
      this.config.stream.storeType === "file" &&
      this.config.stream.fileStoreDir
    ) {
      this.taskStore = new FileTaskStore({
        dir: this.config.stream.fileStoreDir,
      });
    } else {
      this.taskStore = new InMemoryTaskStore();
    }

    // 2. 依据配置装配 CostLedger
    if (this.config.finops.storeType === "redis" && this.config.finops.redisUrl) {
      this.costLedger = new RedisCostLedger({
        url: this.config.finops.redisUrl,
      });
    } else if (this.config.finops.storeType === "ndjson") {
      this.costLedger = new NdjsonCostLedger({
        filePath: this.config.finops.storagePath,
      });
    } else {
      this.costLedger = new InMemoryCostLedger();
    }

    // 3. 依据配置装配 SessionStreamHub
    this.streamHub = new SessionStreamHub({
      store: this.taskStore,
    });

    // 4. 依据配置装配 MCP Manager
    this.mcp = new MCPClientManager();
  }

  /**
   * 运行时动态更新配置（热加载补丁）
   */
  updateConfig(patch: HarnessConfig): ResolvedHarnessConfig {
    this.config = resolveHarnessConfig(patch);
    return this.config;
  }
}
