import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 纯 schema 契约包，无 DOM 依赖
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
