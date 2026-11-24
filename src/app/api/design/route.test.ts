import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@ginkgo-apps/design/server", () => ({
  DesignService: {
    getStatus: vi.fn(async () => ({
      hasCanvas: true,
      canvasTitle: "测试设计",
      boardCount: 1,
      boards: ["Main.dc.html"],
      previewUrl: "http://127.0.0.1:4791/design/mock/",
      hasDesignSystem: true,
    })),
    serve: vi.fn(async () => ({ url: "http://127.0.0.1:4791/design/mock/", pid: 1234 })),
    stop: vi.fn(async () => ({ stopped: true })),
    audit: vi.fn(async () => ({ report: "审查通过", passed: true })),
  },
}));

describe("API /api/design", () => {
  it("GET 缺少 workspacePath 时返回 400", async () => {
    const req = new Request("http://localhost/api/design");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("GET 正常返回工作区设计状态", async () => {
    const req = new Request("http://localhost/api/design?workspacePath=%2Ftmp%2Ftest");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasCanvas).toBe(true);
    expect(data.canvasTitle).toBe("测试设计");
  });

  it("POST action=serve 正常启动预览", async () => {
    const req = new Request("http://localhost/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "serve", workspacePath: "/tmp/test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("http://127.0.0.1:4791/design/mock/");
  });

  it("POST action=audit 正常返回审查结果", async () => {
    const req = new Request("http://localhost/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "audit", workspacePath: "/tmp/test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.passed).toBe(true);
  });
});
