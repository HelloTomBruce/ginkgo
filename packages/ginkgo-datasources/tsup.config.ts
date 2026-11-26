import { defineConfig } from "tsup";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 发布构建：external 保留全部依赖（路线 B：依赖链已发布，不再内联），
 * 仅编译本包源码。开发期仍由消费方直接吃 `src`（见 package.json exports）。
 */
const external = [
    "@clickhouse/client",
    "@duckdb/node-api",
    "ai",
    "exceljs",
    "mysql2",
    "pg",
    /^@ginkgo\//,
];

/**
 * 发布产物修正：esbuild 不认识较新的内置模块 `node:sqlite`，会把静态
 * `import ... from "node:sqlite"` 改写成裸 `"sqlite"`，消费方运行时报
 * `Cannot find package 'sqlite'`。
 *
 * 为什么必须在这里修而不是改源码：
 *   - `createRequire` / 拼接 specifier 会让 Next 的编译期分析报
 *     `Unsupported external type Url for commonjs reference`（仓库内构建是源码直编）；
 *   - 源码保持标准静态 import，两条构建链各走各的。
 *
 * 与"静默字符串替换"的区别：找不到目标模式就**抛错**，不会悄悄产出坏包。
 */
async function fixNodeSqliteSpecifier(): Promise<void> {
  const target = path.resolve("dist/index.js");
  let content: string;
  try {
    content = await fs.readFile(target, "utf-8");
  } catch (err) {
    throw new Error(`[tsup] 无法读取 ${target}: ${String(err)}`);
  }
  if (!content.includes('from "sqlite"')) {
    throw new Error(
      '[tsup] 未在产物中找到 `from "sqlite"`——esbuild 行为可能已修正，' +
        "请删除 fixNodeSqliteSpecifier 并重新验证消费方导入（预期产物含 node:sqlite）"
    );
  }
  await fs.writeFile(target, content.replace('from "sqlite"', 'from "node:sqlite"'), "utf-8");
}

const shared = {
  format: ["esm" as const],
  dts: true,
  splitting: false,
  target: "node22",
  platform: "node" as const,
  external,
  // 只对含 sqlite 方言的入口生效；其它入口无副作用（找不到模式即报错，见函数注释）
  onSuccess: fixNodeSqliteSpecifier,
};

export default defineConfig([
  {
    ...shared,
    entry: {"index": "./src/index.ts", "adapters/ai": "./src/adapters/ai.ts", "schema/card": "./src/schema/card.ts", "schema/store": "./src/schema/store.ts", "sqlGuard": "./src/connectors/db/sqlGuard.ts", "parseToolResult": "./src/parseToolResult.ts", "gateway": "./src/gateway/queryGateway.ts", "certified": "./src/certified/certifiedStore.ts"},
  },
]);
