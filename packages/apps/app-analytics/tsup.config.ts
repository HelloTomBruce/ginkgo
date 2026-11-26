import { defineConfig } from "tsup";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 外部依赖（保持为裸 import，由消费方安装）。
 *
 * ⚠️ 数据库/文件驱动（pg、mysql2、@duckdb/node-api、exceljs、@clickhouse/client）
 * 之所以需要在本包 package.json 中显式声明，是因为 `commonNoExternal` 把
 * `@ginkgo/datasources` 打进了 dist/server.js，而这些驱动被外部化——产物在运行时
 * 直接 import 它们，语义上属于"本包的直接依赖"。
 *
 * 因此不要以"归属 @ginkgo/datasources"为由删除它们：真正的收敛方式是停止
 * 内联 datasources（从 noExternal 移除），这属于发布里程碑的独立决策。
 */
const commonExternal = [
  "node:sqlite",
  "react",
  "react-dom",
  "lucide-react",
  "radix-ui",
  "ai",
  "@openuidev/lang-core",
  "@openuidev/react-lang",
  "@ginkgo/app-sdk",
  /^use-sync-external-store(\/.*)?$/,
  /^recharts(\/.*)?$/,
  /^@duckdb\/.*/,
  /^mysql2(\/.*)?$/,
  /^pg(\/.*)?$/,
  "exceljs",
  "@clickhouse/client",
];

const commonNoExternal = [
  "@ginkgo/components",
  "@ginkgo/chart-spec",
  "@ginkgo/datasources",
];

/**
 * 修正 tsup 对 `node:sqlite` 的裸化产物（`from "sqlite"` → `from "node:sqlite"`）。
 *
 * 这是对打包器解析缺陷的兜底补丁，不是常规构建步骤：一旦打包器修正，本函数应删除。
 * 失败必须显式告警——静默失败会把"产物 import 不到的模块"发布出去。
 */
async function fixNodeSqliteImport() {
  const serverPath = path.resolve("dist/server.js");
  let content: string;
  try {
    content = await fs.readFile(serverPath, "utf-8");
  } catch (err) {
    console.warn(`[tsup] 无法读取 ${serverPath}，跳过 node:sqlite 修正:`, err);
    return;
  }
  if (!content.includes('from "sqlite";')) return;
  try {
    await fs.writeFile(
      serverPath,
      content.replace('from "sqlite";', 'from "node:sqlite";'),
      "utf-8"
    );
  } catch (err) {
    console.warn("[tsup] node:sqlite 修正写入失败，发布前请人工核对 dist/server.js:", err);
  }
}

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
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    platform: "node",
    target: "node22",
    external: commonExternal,
    noExternal: commonNoExternal,
    onSuccess: fixNodeSqliteImport,
  },
]);
