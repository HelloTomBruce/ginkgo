import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { WorkspaceStore, DEFAULT_WORKSPACE_ID } from "./workspaceStore";

describe("WorkspaceStore", () => {
  let tempFile: string;
  let tempDir: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ginkgo-ws-store-"));
    tempFile = path.join(tempDir, "_workspaces.json");
    store = new WorkspaceStore(tempFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("初始自动创建默认工作区", async () => {
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(DEFAULT_WORKSPACE_ID);
    expect(list[0].name).toBe("默认工作区");
  });

  it("支持创建与按应用过滤工作区", async () => {
    await store.create({
      name: "my-project",
      path: "/Users/test/my-project",
      appId: "general",
    });

    const generalList = await store.list("general");
    expect(generalList.some((w) => w.name === "my-project")).toBe(true);

    const analyticsList = await store.list("analytics");
    expect(analyticsList.some((w) => w.name === "my-project")).toBe(false);
  });

  it("路径相同时去重返回已有工作区", async () => {
    const first = await store.create({
      name: "proj",
      path: "/same/path",
      appId: "general",
    });
    const second = await store.create({
      name: "proj-duplicate",
      path: "/same/path",
      appId: "general",
    });
    expect(first.id).toBe(second.id);
  });

  it("默认工作区不可删除", async () => {
    const res = await store.remove(DEFAULT_WORKSPACE_ID);
    expect(res).toBe(false);
  });
});
