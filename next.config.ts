import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  experimental: {
    agentUpgrade: "security",
  },
  cacheComponents: true,
  partialPrefetching: true,
  // DuckDB 原生 .node 插件不可打包进 Turbopack chunk，运行时 require
  serverExternalPackages: [
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "@clickhouse/client",
    "ioredis",
    "@modelcontextprotocol/sdk",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: [require.resolve("@tailwindcss/turbopack")],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
