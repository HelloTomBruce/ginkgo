import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface WorkspaceRecord {
  id: string;
  appId: string;
  name: string;
  /** 本地绝对物理路径；若未提供则为默认隔离沙箱 */
  path?: string;
  createdAt: number;
  updatedAt: number;
}

export const WORKSPACE_STORAGE_PATH = path.join(
  process.cwd(),
  "data",
  "workspaces",
  "_workspaces.json"
);

export const DEFAULT_WORKSPACE_ID = "ws_default";

function generateWorkspaceId(): string {
  return `ws_${crypto.randomBytes(4).toString("hex")}`;
}

export class WorkspaceStore {
  private filePath: string;
  private cache: WorkspaceRecord[] | null = null;

  constructor(filePath = WORKSPACE_STORAGE_PATH) {
    this.filePath = filePath;
  }

  private async load(): Promise<WorkspaceRecord[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        this.cache = list;
        return list;
      }
    } catch {
      // 文件不存在或损坏，初始化
    }

    // 默认工作区初始化
    const defaultWs: WorkspaceRecord = {
      id: DEFAULT_WORKSPACE_ID,
      appId: "general",
      name: "默认工作区",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.cache = [defaultWs];
    await this.persist();
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
  }

  async list(appId?: string): Promise<WorkspaceRecord[]> {
    const all = await this.load();
    if (!appId) return all;
    return all.filter((w) => w.appId === appId || w.id === DEFAULT_WORKSPACE_ID);
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    const all = await this.load();
    return all.find((w) => w.id === id) ?? null;
  }

  async create(data: {
    name: string;
    path?: string;
    appId: string;
  }): Promise<WorkspaceRecord> {
    const all = await this.load();
    // 检查是否已有相同路径的工作区
    if (data.path) {
      const existing = all.find((w) => w.path === data.path);
      if (existing) return existing;
    }

    const newRecord: WorkspaceRecord = {
      id: generateWorkspaceId(),
      name: data.name,
      path: data.path,
      appId: data.appId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    all.push(newRecord);
    await this.persist();
    return newRecord;
  }

  async remove(id: string): Promise<boolean> {
    if (id === DEFAULT_WORKSPACE_ID) return false; // 默认工作区不可删除
    const all = await this.load();
    const idx = all.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    all.splice(idx, 1);
    await this.persist();
    return true;
  }
}

export const workspaceStore = new WorkspaceStore();
