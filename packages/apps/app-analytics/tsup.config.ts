import { defineConfig } from "tsup";

/**
 * 外部依赖（保持为裸 import，由消费方安装）。
 *
 * 路线 B：`@ginkgolab/*` 依赖链已发布，统一 external，不再内联。
 * 内联的问题：CJS 依赖折进 ESM 产物后会运行时报
 * `Dynamic require of "child_process" is not supported`，且体积翻倍。
 *
 * 数据库/文件驱动（pg、mysql2、@duckdb/node-api、exceljs、@clickhouse/client）
 * 由 `@ginkgolab/datasources` 声明；本包只在实际 import 时声明（见 package.json）。
 */
const commonExternal = [
  /^@ginkgo\//,
  "node:sqlite",
  "react",
  "react-dom",
  "lucide-react",
  "radix-ui",
  "ai",
  "@openuidev/lang-core",
  "@openuidev/react-lang",
  "@ginkgolab/app-sdk",
  /^use-sync-external-store(\/.*)?$/,
  /^recharts(\/.*)?$/,
  /^@duckdb\/.*/,
  /^mysql2(\/.*)?$/,
  /^pg(\/.*)?$/,
  "exceljs",
  "@clickhouse/client",
];

const commonNoExternal: string[] = [];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      client: "src/client/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    target: "es2022",
    external: commonExternal,
    noExternal: commonNoExternal,
    banner: {
      js: '"use client";',
    },
  },
  {
    entry: {
      server: "src/server/index.ts",
      isomorphic: "src/isomorphic/index.ts",
      dashboardCapture: "src/isomorphic/dashboardCapture.ts",
      manifestMeta: "src/manifestMeta.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    platform: "node",
    target: "node22",
    external: commonExternal,
    noExternal: commonNoExternal,
  },
]);
