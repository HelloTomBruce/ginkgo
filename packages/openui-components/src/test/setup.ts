import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vmThreads 复用同一 jsdom 实例:逐用例清理已挂载树,防跨文件 DOM/事件泄漏
afterEach(() => {
  cleanup();
});
