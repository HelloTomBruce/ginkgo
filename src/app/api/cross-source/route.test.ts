// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "./route";
import { reloadCrossSourceMap } from "@ginkgo/app-analytics/server";

vi.mock("@/lib/datasources", () => ({
  datasources: {
    list: vi.fn(() => [
      {
        id: "zentao-cli",
        name: "禅道",
        kind: "db",
        dbType: "postgres",
        tools: [],
        enabled: true,
        maskedConnectionString: "postgres://u:***@h/db",
      },
      { id: "gitlab", name: "GitLab", kind: "file", tools: [], enabled: true },
    ]),
  },
}));

const BASE = "http://localhost:3006/api/cross-source";
const MAPPING = {
  projectSource: "zentao-cli",
  project: "42",
  repoSource: "gitlab",
  repo: "backend/trading-platform",
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cross-source-api-"));
  file = path.join(dir, "map.json");
  // 默认注册表指向临时文件，不触碰仓库里的 config/cross-source-map.json
  reloadCrossSourceMap(file);
});

afterEach(() => {
  // 恢复默认配置路径与缓存
  reloadCrossSourceMap();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/cross-source（薄壳 → analytics handler）", () => {
  it("返回映射清单、裁剪后的源列表与能力开关", async () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mappings: [MAPPING],
      sources: [
        { id: "zentao-cli", name: "禅道", enabled: true },
        { id: "gitlab", name: "GitLab", enabled: true },
      ],
      active: true,
    });
  });

  it("每次请求都读当前磁盘状态（不经构建期固化的预渲染结果）", async () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(file, past, past);

    const first = await (await GET()).json();
    fs.writeFileSync(file, JSON.stringify({ mappings: [] }));

    const second = await (await GET()).json();
    expect(first.mappings).toEqual([MAPPING]);
    expect(second.mappings).toEqual([]);
  });
});

describe("PUT /api/cross-source（薄壳 → analytics handler）", () => {
  it("合法清单落盘并回传", async () => {
    const res = await PUT(
      new Request(BASE, {
        method: "PUT",
        body: JSON.stringify({ mappings: [{ ...MAPPING, project: " 42 " }] }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mappings).toEqual([MAPPING]);
    expect(body.active).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({
      mappings: [MAPPING],
    });
  });

  it("校验失败 400 + errors，不落盘", async () => {
    const res = await PUT(
      new Request(BASE, {
        method: "PUT",
        body: JSON.stringify({ mappings: [{ project: "42" }] }),
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([
      "第 1 条映射：项目管理侧数据源 id、代码仓库侧数据源 id、仓库路径 不能为空",
    ]);
    expect(fs.existsSync(file)).toBe(false);
  });
});
