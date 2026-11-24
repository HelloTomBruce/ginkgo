import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AppServerContext } from "@ginkgo/app-sdk";
import { createDesignTools, getDesignTools } from "./tools";

describe("createDesignTools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "design-tools-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("在执行模式 (isReadonly=false) 下能够正常初始化 canvas.json 与 Main.dc.html", async () => {
    const tools = createDesignTools(tempDir, false);
    expect(tools.design_canvas_init?.execute).toBeDefined();
    const result = (await tools.design_canvas_init!.execute!(
      { title: "营销落地页", width: 880, height: 560 },
      { messages: [], toolCallId: "call-1" }
    )) as { success: boolean; canvasJsonPath: string; mainDcPath: string };

    expect(result.success).toBe(true);
    expect(result.canvasJsonPath).toBe("project/canvas.json");

    // 验证文件存在
    const canvasJson = JSON.parse(
      await fs.readFile(path.join(tempDir, "project", "canvas.json"), "utf-8")
    );
    expect(canvasJson.title).toBe("营销落地页");
    expect(canvasJson.boards["Main.dc.html"]).toBeDefined();
    expect(canvasJson.boards["Main.dc.html"].w).toBe(880);

    const mainDc = await fs.readFile(path.join(tempDir, "project", "Main.dc.html"), "utf-8");
    expect(mainDc).toContain("<script src=\"./support.js\"></script>");
    expect(mainDc).toContain("<x-dc>");
    expect(mainDc).toContain("class Component extends DCLogic");
  });

  it("在规划模式 (isReadonly=true) 下坚决不装配任何写工具与服务控制工具", () => {
    const tools = createDesignTools(tempDir, true);

    // 写工具与副作用工具严格不可见
    expect(tools.design_canvas_init).toBeUndefined();
    expect(tools.design_canvas_serve).toBeUndefined();
    expect(tools.design_canvas_stop).toBeUndefined();
    expect((tools as Record<string, unknown>).write_file).toBeUndefined();
    expect((tools as Record<string, unknown>).edit_file).toBeUndefined();

    // 只读分析与审查工具保留
    expect(tools.read_file).toBeDefined();
    expect(tools.design_canvas_check).toBeDefined();
    expect(tools.design_system_audit).toBeDefined();
  });

  it("getDesignTools 在 plan 模式下只读，在 execute 与 direct 模式下具备完整构建写权限", () => {
    const planTools = getDesignTools({
      mode: "plan",
      sessionId: "sess_test",
      workspace: { sandboxDir: tempDir },
    } as unknown as AppServerContext);
    expect(planTools.design_canvas_init).toBeUndefined();
    expect(planTools.write_file).toBeUndefined();
    expect(planTools.read_file).toBeDefined();

    const executeTools = getDesignTools({
      mode: "execute",
      sessionId: "sess_test",
      workspace: { sandboxDir: tempDir },
    } as unknown as AppServerContext);
    expect(executeTools.design_canvas_init).toBeDefined();
    expect(executeTools.write_file).toBeDefined();

    const directTools = getDesignTools({
      mode: "direct",
      sessionId: "sess_test",
      workspace: { sandboxDir: tempDir },
    } as unknown as AppServerContext);
    expect(directTools.design_canvas_init).toBeDefined();
    expect(directTools.write_file).toBeDefined();
  });
});
