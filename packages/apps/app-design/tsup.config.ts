import { defineConfig } from "tsup";

/**
 * 发布构建（路线 B）：`@ginkgolab/*` 依赖链已发布，统一 external——不再内联。
 *
 * 内联会把 CJS 依赖（harness-core 及其三方包）折进 ESM 产物，运行时报
 * `Dynamic require of "child_process" is not supported`；且体积翻倍。
 */
const external = [/^@ginkgo\//, "react", "react-dom", "lucide-react", "zod"];

export default defineConfig([
  {
    entry: {
      definition: "src/index.ts",
      client: "src/client/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    target: "es2022",
    external,
    banner: {
      js: '"use client";',
    },
  },
  {
    // 服务端安全入口（manifestMeta / server）：**不加** "use client"
    entry: {
      server: "src/server/index.ts",
      manifestMeta: "src/manifestMeta.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    target: "es2022",
    external,
  },
]);
