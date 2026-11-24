// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import { POST } from "./route";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    default: {
      ...actual,
      platform: vi.fn(() => "darwin"),
    },
    platform: vi.fn(() => "darwin"),
  };
});

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("@/lib/workspaceStore", () => ({
  workspaceStore: {
    create: vi.fn().mockImplementation(async (data) => ({
      id: "ws_mock_id",
      name: data.name,
      path: data.path,
      appId: data.appId,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    })),
  },
}));

describe("POST /api/workspace/pick-folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.platform).mockReturnValue("darwin");
  });

  it("macOS: 当用户取消选择时返回 canceled: true", async () => {
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, callback) => {
      callback(new Error("User canceled. (-128)"), { stdout: "", stderr: "" });
    });

    const req = new Request("http://localhost/api/workspace/pick-folder", {
      method: "POST",
      body: JSON.stringify({ appId: "general" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canceled).toBe(true);
  });

  it("macOS: 当用户选择目录时成功创建并返回工作区", async () => {
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, callback) => {
      callback(null, { stdout: "/Users/test/my-project/\n", stderr: "" });
    });

    const req = new Request("http://localhost/api/workspace/pick-folder", {
      method: "POST",
      body: JSON.stringify({ appId: "general" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.workspace).toBeDefined();
    expect(data.workspace.path).toBe("/Users/test/my-project");
    expect(data.workspace.name).toBe("my-project");
  });

  it("非 macOS (Linux/Windows): 未传 path 时返回 400 友好提示", async () => {
    vi.mocked(os.platform).mockReturnValue("linux");

    const req = new Request("http://localhost/api/workspace/pick-folder", {
      method: "POST",
      body: JSON.stringify({ appId: "general" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("当前系统暂不支持原生对话框");
  });

  it("非 macOS (Linux/Windows): 传入有效 path 时成功创建工作区", async () => {
    vi.mocked(os.platform).mockReturnValue("linux");

    const req = new Request("http://localhost/api/workspace/pick-folder", {
      method: "POST",
      body: JSON.stringify({ appId: "general", path: "/var/projects/demo" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.workspace).toBeDefined();
    expect(data.workspace.path).toBe("/var/projects/demo");
    expect(data.workspace.name).toBe("demo");
  });
});
