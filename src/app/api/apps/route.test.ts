import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import { POST as installPost } from "./install/route";
import { POST as togglePost } from "./[appId]/toggle/route";
import { DELETE as uninstallDelete } from "./[appId]/route";
import { AppPackageManager } from "@/lib/apps/packageManager";

describe("/api/apps 应用管理 API 薄壳路由", () => {
  it("GET /api/apps 返回应用列表及健康检查结果", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.apps)).toBe(true);
    expect(json.activeCount).toBeGreaterThan(0);

    const analytics = json.apps.find((a: { id: string }) => a.id === "analytics");
    expect(analytics).toBeDefined();
    expect(analytics.health).toBeDefined();
  });

  describe("POST /api/apps/install 高危能力三道闸门", () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it("默认关闭：未设置 GINKGO_ALLOW_APP_INSTALL 时返回 403，且不触达安装逻辑", async () => {
      delete process.env.GINKGO_ALLOW_APP_INSTALL;
      const installSpy = vi.spyOn(AppPackageManager, "installPackage");

      const req = new Request("http://localhost:3006/api/apps/install", {
        method: "POST",
        body: JSON.stringify({ packageSpec: "@demo/app" }),
      });
      const res = await installPost(req);

      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("GINKGO_ALLOW_APP_INSTALL");
      expect(installSpy).not.toHaveBeenCalled();
      installSpy.mockRestore();
    });

    it("开启但配置了令牌时：缺少/错误令牌返回 401", async () => {
      process.env.GINKGO_ALLOW_APP_INSTALL = "1";
      process.env.GINKGO_APP_INSTALL_TOKEN = "secret-token";
      const installSpy = vi.spyOn(AppPackageManager, "installPackage");

      const missing = await installPost(
        new Request("http://localhost:3006/api/apps/install", {
          method: "POST",
          body: JSON.stringify({ packageSpec: "@demo/app" }),
        })
      );
      expect(missing.status).toBe(401);

      const wrong = await installPost(
        new Request("http://localhost:3006/api/apps/install", {
          method: "POST",
          headers: { "x-ginkgo-install-token": "nope" },
          body: JSON.stringify({ packageSpec: "@demo/app" }),
        })
      );
      expect(wrong.status).toBe(401);
      expect(installSpy).not.toHaveBeenCalled();
      installSpy.mockRestore();
    });

    it("开启 + 令牌正确时放行", async () => {
      process.env.GINKGO_ALLOW_APP_INSTALL = "1";
      process.env.GINKGO_APP_INSTALL_TOKEN = "secret-token";
      const installSpy = vi
        .spyOn(AppPackageManager, "installPackage")
        .mockResolvedValueOnce({ success: true, appId: "demo_app", name: "演示插件" });

      const res = await installPost(
        new Request("http://localhost:3006/api/apps/install", {
          method: "POST",
          headers: { "x-ginkgo-install-token": "secret-token" },
          body: JSON.stringify({ packageSpec: "@demo/app" }),
        })
      );

      expect(res.status).toBe(200);
      installSpy.mockRestore();
    });

    it("非法 spec 在路由层即返回 400（不触达安装）", async () => {
      process.env.GINKGO_ALLOW_APP_INSTALL = "1";
      delete process.env.GINKGO_APP_INSTALL_TOKEN;
      const installSpy = vi.spyOn(AppPackageManager, "installPackage");

      const res = await installPost(
        new Request("http://localhost:3006/api/apps/install", {
          method: "POST",
          body: JSON.stringify({ packageSpec: "../../etc/passwd" }),
        })
      );

      expect(res.status).toBe(400);
      expect(installSpy).not.toHaveBeenCalled();
      installSpy.mockRestore();
    });

    it("权限握手：permissions_required 映射为 409 并回传权限清单", async () => {
      process.env.GINKGO_ALLOW_APP_INSTALL = "1";
      delete process.env.GINKGO_APP_INSTALL_TOKEN;
      const installSpy = vi.spyOn(AppPackageManager, "installPackage").mockResolvedValueOnce({
        success: false,
        appId: "permy",
        code: "permissions_required",
        requiredPermissions: ["shell.execute"],
        message: "需确认权限",
      });

      const res = await installPost(
        new Request("http://localhost:3006/api/apps/install", {
          method: "POST",
          body: JSON.stringify({ packageSpec: "@demo/permy" }),
        })
      );

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.requiredPermissions).toEqual(["shell.execute"]);
      expect(json.hint).toContain("acknowledgedPermissions");
      installSpy.mockRestore();
    });
  });

  it("POST /api/apps/install 校验参数缺失时返回 400", async () => {
    process.env.GINKGO_ALLOW_APP_INSTALL = "1";
    const req = new Request("http://localhost:3006/api/apps/install", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await installPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("packageSpec");
  });

  it("POST /api/apps/install 委托 AppPackageManager.installPackage 执行", async () => {
    process.env.GINKGO_ALLOW_APP_INSTALL = "1";
    const installSpy = vi.spyOn(AppPackageManager, "installPackage").mockResolvedValueOnce({
      success: true,
      appId: "demo_app",
      name: "演示插件",
    });

    const req = new Request("http://localhost:3006/api/apps/install", {
      method: "POST",
      body: JSON.stringify({ packageSpec: "@demo/app" }),
    });

    const res = await installPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.appId).toBe("demo_app");
    expect(installSpy).toHaveBeenCalledWith("@demo/app", { enableImmediately: true });

    installSpy.mockRestore();
  });

  it("POST /api/apps/[appId]/toggle 切换启停状态", async () => {
    const toggleSpy = vi.spyOn(AppPackageManager, "toggleApp").mockResolvedValueOnce({
      success: true,
    });

    const req = new Request("http://localhost:3006/api/apps/analytics/toggle", {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    });

    const res = await togglePost(req, { params: Promise.resolve({ appId: "analytics" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.enabled).toBe(false);

    toggleSpy.mockRestore();
  });

  it("DELETE /api/apps/[appId] 委托卸载", async () => {
    const uninstallSpy = vi.spyOn(AppPackageManager, "uninstallPackage").mockResolvedValueOnce({
      success: true,
      message: "已卸载",
    });

    const req = new Request("http://localhost:3006/api/apps/some_app", {
      method: "DELETE",
    });

    const res = await uninstallDelete(req, { params: Promise.resolve({ appId: "some_app" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    uninstallSpy.mockRestore();
  });
});
