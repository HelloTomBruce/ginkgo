import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDesignTools } from "./tools";

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
    expect(tools.design_canvas_init.execute).toBeDefined();
    const result = (await tools.design_canvas_init.execute!(
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

  it("在规划模式 (isReadonly=true) 下禁止初始化并返回友好提示", async () => {
    const tools = createDesignTools(tempDir, true);
    expect(tools.design_canvas_init.execute).toBeDefined();
    const result = (await tools.design_canvas_init.execute!(
      { title: "未确认方案", width: 880, height: 560 },
      { messages: [], toolCallId: "call-2" }
    )) as { error: string; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.error).toContain("Plan 规划模式（只读）");
  });
});
