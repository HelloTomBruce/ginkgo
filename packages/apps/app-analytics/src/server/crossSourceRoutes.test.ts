// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CrossSourceRegistry } from "./crossSource";
import {
  handleListCrossSource,
  handleReplaceCrossSource,
  type CrossSourceRouteDeps,
} from "./crossSourceRoutes";

const MAPPING = {
  projectSource: "zentao-cli",
  project: "42",
  projectName: "交易平台重构",
  repoSource: "gitlab",
  repo: "backend/trading-platform",
};

const BASE = "http://localhost:3006/api/cross-source";

let dir: string;
let file: string;
let deps: CrossSourceRouteDeps;

function put(body: string) {
  return handleReplaceCrossSource(
    new Request(BASE, { method: "PUT", body }),
    deps
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cross-source-routes-"));
  file = path.join(dir, "map.json");
  deps = {
    // gitlab 停用：映射存在但单侧未启用，能力不成立
    sources: [
      { id: "zentao-cli", name: "禅道", enabled: true },
      { id: "gitlab", name: "GitLab", enabled: false },
    ],
    registry: new CrossSourceRegistry({ configPath: file }),
  };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/cross-source", () => {
  it("返回映射清单、源列表（仅 id/name/enabled）与能力开关，不触发落盘", async () => {
    deps.sources = [
      {
        id: "gitlab",
        name: "GitLab",
        enabled: false,
        // 组合根传入的是完整描述符：响应须裁剪到分区所需字段
        maskedConnectionString: "postgres://u:***@h/db",
      } as CrossSourceRouteDeps["sources"][number],
    ];

    const res = handleListCrossSource(deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mappings: [],
      sources: [{ id: "gitlab", name: "GitLab", enabled: false }],
      active: false,
    });
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("PUT /api/cross-source", () => {
  it("合法清单：落盘并回传规范化结果；单侧源停用时能力不成立", async () => {
    const res = await put(
      JSON.stringify({
        mappings: [{ ...MAPPING, projectSource: " zentao-cli ", projectName: "" }],
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mappings: [
        {
          projectSource: "zentao-cli",
          project: "42",
          repoSource: "gitlab",
          repo: "backend/trading-platform",
        },
      ],
      sources: deps.sources,
      active: false,
    });
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({
      mappings: [
        {
          projectSource: "zentao-cli",
          project: "42",
          repoSource: "gitlab",
          repo: "backend/trading-platform",
        },
      ],
    });
  });

  it("映射双侧源均启用时 active=true，且与 /api/datasources 的 features 同一判定", async () => {
    deps.sources = deps.sources.map((s) => ({ ...s, enabled: true }));

    const res = await put(JSON.stringify({ mappings: [MAPPING] }));

    expect((await res.json()).active).toBe(true);
  });

  it("清空清单：mappings 为空数组即能力关闭", async () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));

    const res = await put(JSON.stringify({ mappings: [] }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mappings).toEqual([]);
    expect(body.active).toBe(false);
  });

  it("请求体缺 mappings 或不是 JSON：400 且不落盘", async () => {
    for (const raw of ["{}", "{ not json", JSON.stringify({ mapping: [] })]) {
      const res = await put(raw);
      expect(res.status).toBe(400);
      expect(Array.isArray((await res.json()).errors)).toBe(true);
    }
    expect(fs.existsSync(file)).toBe(false);
  });

  it("映射校验失败：400 附逐条 errors，原文件不变", async () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));
    const before = fs.readFileSync(file, "utf-8");

    const res = await put(
      JSON.stringify({ mappings: [MAPPING, { ...MAPPING, repo: "" }] })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([
      "第 2 条映射：仓库路径 不能为空",
    ]);
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });

  it("配置文件损坏：500 带原因，不覆盖原文件", async () => {
    fs.writeFileSync(file, "{ broken");

    const res = await put(JSON.stringify({ mappings: [] }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("不是合法的 JSON 对象");
    expect(fs.readFileSync(file, "utf-8")).toBe("{ broken");
  });

  it("保存结果对其它注册表实例可见（新实例从同一文件读出）", async () => {
    await put(JSON.stringify({ mappings: [MAPPING] }));

    const res = handleListCrossSource({
      ...deps,
      registry: new CrossSourceRegistry({ configPath: file }),
    });

    expect((await res.json()).mappings).toEqual([MAPPING]);
  });
});
