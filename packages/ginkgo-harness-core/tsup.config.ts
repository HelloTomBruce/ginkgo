import { defineConfig } from "tsup";

/**
 * 发布构建：external 保留全部依赖（路线 B：依赖链已发布，不再内联），
 * 仅编译本包源码。开发期仍由消费方直接吃 `src`（见 package.json exports）。
 */
const external = [
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ginkgolab/models",
    "@modelcontextprotocol/sdk",
    "ai",
    "zod",
    /^@ginkgo\//,
];

const shared = {
  format: ["esm" as const],
  dts: true,
  splitting: false,
  target: "node22",
  platform: "node" as const,
  external,
};

export default defineConfig([
  {
    ...shared,
    entry: {"index": "./src/index.ts", "pipeline": "./src/pipeline/index.ts", "graph": "./src/graph/index.ts", "finops": "./src/finops/index.ts", "stream": "./src/stream/index.ts", "telemetry": "./src/telemetry/index.ts", "mcp": "./src/mcp/index.ts", "registry": "./src/providers/registry.ts", "config": "./src/config/index.ts", "context": "./src/context/index.ts", "tokenizer": "./src/tokenizer/index.ts", "tools": "./src/tools/index.ts", "lifecycle": "./src/lifecycle/index.ts"},
  },
]);
