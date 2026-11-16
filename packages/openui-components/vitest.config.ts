import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 组件库测试需要 DOM 环境（recharts/testing-library 依赖浏览器 API）
    environment: "jsdom",
    // 同根配置:jsdom 每 worker 复用,消除每文件重建开销(22 次/12.6s)
    pool: "vmThreads",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    env: {
      NODE_ENV: "test",
    },
  },
});
