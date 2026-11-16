import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vmThreads 复用同一 jsdom 实例:不清理则上一文件的已挂载树(含 Radix dialog
// 的 document 级监听)泄漏到下一文件,截胡事件。globals 未开启,自动 cleanup
// 不会注册,这里显式逐用例清理
afterEach(() => {
  cleanup();
});

// Radix UI（Slider/Select/Dialog 等）依赖的浏览器 API 在 jsdom 中缺失，统一 mock
// （node 环境的测试没有 DOM，守卫跳过）
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ||= (() => false) as typeof Element.prototype.hasPointerCapture;
  Element.prototype.releasePointerCapture ||= (() => {}) as typeof Element.prototype.releasePointerCapture;
  Element.prototype.scrollIntoView ||= (() => {}) as typeof Element.prototype.scrollIntoView;
}
