import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchDesignAction } from "./dispatchAction";
import { DesignService } from "./designService";

vi.mock("./designService", () => ({
  DesignService: {
    getStatus: vi.fn(async () => ({ hasCanvas: true })),
    listArtifacts: vi.fn(async () => []),
    serve: vi.fn(async () => ({ url: "http://127.0.0.1:4791/design/mock/" })),
    stop: vi.fn(async () => ({ stopped: true })),
    audit: vi.fn(async () => ({ report: "审查通过", passed: true })),
  },
}));

const ctx = { appId: "design", sessionId: "sess-1", workspaceDir: "/tmp/sandbox" };

describe("dispatchDesignAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status / artifacts / serve / stop 委托 DesignService 并传入网关解析的可信沙箱路径", async () => {
    await dispatchDesignAction("status", {}, ctx);
    expect(DesignService.getStatus).toHaveBeenCalledWith("/tmp/sandbox");

    await dispatchDesignAction("artifacts", {}, ctx);
    expect(DesignService.listArtifacts).toHaveBeenCalledWith("/tmp/sandbox");

    await dispatchDesignAction("serve", {}, ctx);
    expect(DesignService.serve).toHaveBeenCalledWith("/tmp/sandbox");

    await dispatchDesignAction("stop", {}, ctx);
    expect(DesignService.stop).toHaveBeenCalledWith("/tmp/sandbox");
  });

  it("audit 忽略 payload 中客户端透传的 targetDir，恒用可信沙箱路径（防路径注入）", async () => {
    await dispatchDesignAction(
      "audit",
      { targetDir: "/Users/zhangbei/evil" },
      ctx
    );
    expect(DesignService.audit).toHaveBeenCalledTimes(1);
    expect(DesignService.audit).toHaveBeenCalledWith("/tmp/sandbox");
    expect(DesignService.audit).not.toHaveBeenCalledWith("/Users/zhangbei/evil");
  });

  it("未知动作抛错（网关映射为 500）", async () => {
    await expect(dispatchDesignAction("hack", {}, ctx)).rejects.toThrow(
      "Unknown design action: hack"
    );
  });
});
