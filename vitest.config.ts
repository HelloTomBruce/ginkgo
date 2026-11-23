import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // 根自身作为 project（应用测试，jsdom）+ packages/* 子包（各自配置，node 环境）
    projects: [".", "packages/openui-*", "packages/apps/*"],
    environment: "jsdom",
    // jsdom 环境每 worker 复用（此前每测试文件重建一次,55 次/29s 占全时长 37%）;
    // vmThreads 保持文件级隔离,仅共享同一 jsdom 实例与 worker 进程
    pool: "vmThreads",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // 强制 test 环境：shell 中若已有 NODE_ENV=production，vitest 不会覆盖，
    // React 会因此加载 production 构建（无 React.act），导致组件测试全部失败。
    env: {
      NODE_ENV: "test",
    },
  },
});
