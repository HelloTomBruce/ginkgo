import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/storagePaths", () => ({
  getPluginsDir: vi.fn(() => "/mock-plugins"),
}));

vi.mock("@/lib/apps/appConfigServer", () => ({
  loadAppsConfig: vi.fn(async () => ({
    apps: [
      { id: "analytics", builtin: true },
      { id: "thirdparty", package: "@acme/app-finance", enabled: true },
    ],
  })),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(async (p: string) => {
      if (p.includes("client.js")) return;
      throw new Error("ENOENT");
    }),
    readFile: vi.fn(async () => Buffer.from("console.log('client app');")),
  },
}));

describe("GET /api/apps/[appId]/assets/[...file]", () => {
  it("内置应用不提供 assets，返回 404", async () => {
    const res = await GET(new Request("http://localhost/api/apps/analytics/assets/client.js"), {
      params: Promise.resolve({ appId: "analytics", file: ["client.js"] }),
    });
    expect(res.status).toBe(404);
  });

  it("路径穿越拦截返回 400", async () => {
    const res = await GET(new Request("http://localhost/api/apps/thirdparty/assets/../../etc/passwd"), {
      params: Promise.resolve({ appId: "thirdparty", file: ["..", "..", "etc", "passwd"] }),
    });
    expect(res.status).toBe(400);
  });

  it("已安装第三方应用返回正确的客户端脚本和 Content-Type", async () => {
    const res = await GET(new Request("http://localhost/api/apps/thirdparty/assets/client.js"), {
      params: Promise.resolve({ appId: "thirdparty", file: ["client.js"] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
    // 短 max-age：应用升级原地替换文件，immutable 会导致浏览器永不拉新
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    // 直出类内容阻断内嵌脚本同源执行
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    const text = await res.text();
    expect(text).toContain("client app");
  });

  it("文件不存在返回 404", async () => {
    const res = await GET(new Request("http://localhost/api/apps/thirdparty/assets/missing.js"), {
      params: Promise.resolve({ appId: "thirdparty", file: ["missing.js"] }),
    });
    expect(res.status).toBe(404);
  });

  it("反斜杠形式的穿越片段同样拦截返回 400", async () => {
    const res = await GET(
      new Request("http://localhost/api/apps/thirdparty/assets/..%5C..%5Cwin.ini"),
      { params: Promise.resolve({ appId: "thirdparty", file: ["..\\..\\win.ini"] }) }
    );
    expect(res.status).toBe(400);
  });

  it("读取异常返回固定 500 文案（不泄露内部错误细节）", async () => {
    const { loadAppsConfig } = await import("@/lib/apps/appConfigServer");
    vi.mocked(loadAppsConfig).mockRejectedValueOnce(new Error("/secret/path/db.json parse fail"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET(
        new Request("http://localhost/api/apps/thirdparty/assets/client.js"),
        { params: Promise.resolve({ appId: "thirdparty", file: ["client.js"] }) }
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal error");
      expect(body.error).not.toContain("/secret/path");
    } finally {
      errSpy.mockRestore();
    }
  });
});
