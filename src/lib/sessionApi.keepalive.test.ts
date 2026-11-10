import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { updateSessionApi } from "./sessionApi";

/** keepalive 体积判定按 UTF-8 字节数（而非 UTF-16 length）的回归测试 */
describe("updateSessionApi keepalive 体积判定", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ session: { id: "s1" } }), { status: 200 })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("中文-heavy 消息：字符数 < 60000 但字节数超限 → 不启用 keepalive", async () => {
    // 3 万个中文字符：length=30000（旧逻辑误判安全），UTF-8 字节=90000 > 60000
    const cjk = "析".repeat(30000);
    await updateSessionApi(
      "s1",
      { messages: [{ role: "user", content: cjk }] as never },
      { keepalive: true }
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBeUndefined();
  });

  it("小体积请求 → 启用 keepalive", async () => {
    await updateSessionApi("s1", { title: "短标题" }, { keepalive: true });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
  });

  it("未显式要求 keepalive → 不启用", async () => {
    await updateSessionApi("s1", { title: "x" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBeUndefined();
  });
});
