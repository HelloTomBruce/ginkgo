/**
 * @ginkgolab/models - 内部共享：localStorage 安全访问
 * SSR / Node 环境返回 null（调用方自行降级）。仅供包内模块复用，不对外导出。
 */

export function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  if (typeof globalThis !== "undefined" && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}
