import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useEnabledApps } from "./useEnabledApps";

/**
 * 启用态必须来自服务端：客户端的 appRegistry 是打包期常量，
 * 服务端启停/卸载应用后只有重新拉取才能反映真实状态。
 */
function Probe() {
  const { ids, error, refresh } = useEnabledApps();
  return (
    <div>
      <span data-testid="ids">
        {ids === null ? "null" : Array.from(ids).sort().join(",")}
      </span>
      <span data-testid="error">{error ?? ""}</span>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
    </div>
  );
}

describe("useEnabledApps", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("首屏拉取并按 enabled 过滤", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        apps: [
          { id: "analytics", enabled: true },
          { id: "design", enabled: false },
          { id: "general", enabled: true },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<Probe />);

    // 初始为 null（尚未加载），避免首屏误判为空列表
    expect(screen.getByTestId("ids").textContent).toBe("null");

    await waitFor(() =>
      expect(screen.getByTestId("ids").textContent).toBe("analytics,general")
    );
  });

  it("refresh 返回最新集合（供事件回调判定当前应用是否被停用）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [{ id: "analytics", enabled: true }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [
            { id: "analytics", enabled: false },
            { id: "general", enabled: true },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    let returned: Set<string> | null = null;
    function RefreshProbe() {
      const { refresh } = useEnabledApps();
      return (
        <button
          type="button"
          onClick={() => {
            void refresh().then((next) => {
              returned = next;
            });
          }}
        >
          go
        </button>
      );
    }

    render(<RefreshProbe />);
    await act(async () => {
      screen.getByText("go").click();
    });

    await waitFor(() => expect(returned).not.toBeNull());
    expect(Array.from(returned as unknown as Set<string>)).toEqual(["general"]);
  });

  it("加载失败时记录 error 且 ids 保持 null（不误判为全部停用）", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    render(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toContain("HTTP 500")
    );
    expect(screen.getByTestId("ids").textContent).toBe("null");
  });
});
