// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getCrossSourceLinks,
  listCrossSourcePairs,
  resolveCrossSourcePairs,
  reloadCrossSourceMap,
  CrossSourceRegistry,
  validateMappings,
} from "./crossSource";

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cross-source-")),
    "map.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

afterEach(() => {
  // 恢复默认配置路径与缓存
  reloadCrossSourceMap();
});

const MAPPING = {
  projectSource: "zentao-cli",
  project: "42",
  projectName: "交易平台重构",
  repoSource: "gitlab",
  repo: "backend/trading-platform",
};

describe("跨源配对解析（映射自带双源 id，无独立开关）", () => {
  it("无映射：能力关闭", () => {
    reloadCrossSourceMap(writeTempConfig(JSON.stringify({ mappings: [] })));
    expect(listCrossSourcePairs()).toEqual([]);
    expect(resolveCrossSourcePairs(["zentao-cli", "gitlab"])).toEqual([]);
  });

  it("映射存在且双侧源激活：能力成立", () => {
    reloadCrossSourceMap(
      writeTempConfig(JSON.stringify({ mappings: [MAPPING] }))
    );
    expect(listCrossSourcePairs()).toEqual([
      { projectSource: "zentao-cli", repoSource: "gitlab" },
    ]);
    expect(
      resolveCrossSourcePairs(["zentao-cli", "gitlab", "psql"])
    ).toEqual([{ projectSource: "zentao-cli", repoSource: "gitlab" }]);
  });

  it("映射的任一侧源未激活：能力关闭（会话级勾选自然生效）", () => {
    reloadCrossSourceMap(
      writeTempConfig(JSON.stringify({ mappings: [MAPPING] }))
    );
    expect(resolveCrossSourcePairs(["zentao-cli"])).toEqual([]);
    expect(resolveCrossSourcePairs(["gitlab"])).toEqual([]);
    expect(resolveCrossSourcePairs([])).toEqual([]);
  });

  it("多条映射去重出多个配对；单侧激活的配对被过滤", () => {
    reloadCrossSourceMap(
      writeTempConfig(
        JSON.stringify({
          mappings: [
            MAPPING,
            { ...MAPPING, project: "43" }, // 同配对第二条映射
            {
              projectSource: "jira",
              project: "PROJ-1",
              repoSource: "github",
              repo: "org/repo",
            },
          ],
        })
      )
    );
    expect(listCrossSourcePairs()).toEqual([
      { projectSource: "zentao-cli", repoSource: "gitlab" },
      { projectSource: "jira", repoSource: "github" },
    ]);
    // 只激活 jira + github：只剩这一对
    expect(resolveCrossSourcePairs(["jira", "github"])).toEqual([
      { projectSource: "jira", repoSource: "github" },
    ]);
  });
});

describe("getCrossSourceLinks 项目 → 仓库映射", () => {
  it("映射命中时返回仓库路径与 mapped", () => {
    reloadCrossSourceMap(
      writeTempConfig(JSON.stringify({ mappings: [MAPPING] }))
    );
    expect(getCrossSourceLinks("42")).toEqual({
      repo: "backend/trading-platform",
      repoSource: "gitlab",
      confidence: "mapped",
      projectName: "交易平台重构",
    });
  });

  it("projectSource 参数可在多配对下消歧", () => {
    reloadCrossSourceMap(
      writeTempConfig(
        JSON.stringify({
          mappings: [
            MAPPING,
            {
              projectSource: "jira",
              project: "42",
              repoSource: "github",
              repo: "org/other",
            },
          ],
        })
      )
    );
    expect(getCrossSourceLinks("42", "jira")).toEqual({
      repo: "org/other",
      repoSource: "github",
      confidence: "mapped",
      projectName: undefined,
    });
  });

  it("旧字段名（顶层 pair + zentaoProjectId/gitlabProject）兼容读取", () => {
    const file = writeTempConfig(
      JSON.stringify({
        pair: { projectSource: "zentao-cli", repoSource: "gitlab" },
        mappings: [
          {
            zentaoProjectId: "42",
            zentaoProjectName: "交易平台重构",
            gitlabProject: "backend/trading-platform",
          },
        ],
      })
    );
    reloadCrossSourceMap(file);

    expect(getCrossSourceLinks("42")).toEqual({
      repo: "backend/trading-platform",
      repoSource: "gitlab",
      confidence: "mapped",
      projectName: "交易平台重构",
    });
    expect(listCrossSourcePairs()).toEqual([
      { projectSource: "zentao-cli", repoSource: "gitlab" },
    ]);
  });

  it("缺源 id 的条目被丢弃", () => {
    reloadCrossSourceMap(
      writeTempConfig(
        JSON.stringify({ mappings: [{ project: "42", repo: "a/b" }] })
      )
    );
    expect(listCrossSourcePairs()).toEqual([]);
    expect(getCrossSourceLinks("42").confidence).toBe("none");
  });

  it("配置文件不存在时降级为 none 且不抛错", () => {
    reloadCrossSourceMap("/nonexistent/path/cross-source-map.json");
    expect(() => getCrossSourceLinks("42")).not.toThrow();
    expect(getCrossSourceLinks("42")).toEqual({
      repo: null,
      confidence: "none",
    });
    expect(listCrossSourcePairs()).toEqual([]);
  });

  it("配置文件 JSON 损坏时降级为 none 且不抛错", () => {
    const file = writeTempConfig("{ not valid json !!!");
    reloadCrossSourceMap(file);

    expect(getCrossSourceLinks("42")).toEqual({
      repo: null,
      confidence: "none",
    });
  });
});

describe("validateMappings 整份清单校验与规范化", () => {
  it("合法清单：字段去空白，空白 projectName 视为未填；源 id 不要求已存在", () => {
    expect(
      validateMappings([
        { ...MAPPING, projectSource: " zentao-cli ", projectName: "  " },
        {
          projectSource: "jira",
          project: "PROJ-1",
          repoSource: "github",
          repo: "org/repo",
        },
      ])
    ).toEqual({
      ok: true,
      mappings: [
        {
          projectSource: "zentao-cli",
          project: "42",
          repoSource: "gitlab",
          repo: "backend/trading-platform",
        },
        {
          projectSource: "jira",
          project: "PROJ-1",
          repoSource: "github",
          repo: "org/repo",
        },
      ],
    });
  });

  it("非数组拒绝", () => {
    expect(validateMappings({ mappings: [] })).toEqual({
      ok: false,
      errors: ["mappings 必须是数组"],
    });
  });

  it("逐条报告问题：缺失的必填字段与非对象条目", () => {
    const verdict = validateMappings([
      { projectSource: "a", project: "1", repoSource: "b", repo: "x/y" },
      {
        projectSource: "a",
        project: "  ",
        repoSource: "",
        repo: "x/y",
        projectName: "n",
      },
      "garbage",
    ]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.errors).toEqual([
        "第 2 条映射：项目标识、代码仓库侧数据源 id 不能为空",
        "第 3 条映射：必须是对象",
      ]);
    }
  });

  it("同一项目管理侧源下的项目重复映射即拒绝（取首条命中，重复即歧义）", () => {
    const verdict = validateMappings([MAPPING, { ...MAPPING, repo: "other" }]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.errors).toEqual([
        "第 2 条映射：项目 42（源 zentao-cli）重复映射，同一项目只能对应一个仓库",
      ]);
    }
    // 不同项目管理侧源下的同名项目 id 不算重复
    expect(
      validateMappings([
        MAPPING,
        { ...MAPPING, projectSource: "jira", repoSource: "github" },
      ]).ok
    ).toBe(true);
  });
});

describe("replaceMappings 写路径与 mtime 热加载", () => {
  let dir: string;
  let file: string;

  const readJson = () =>
    JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cross-source-write-"));
    file = path.join(dir, "map.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("文件不存在时新建，写入规范化清单并刷新本实例缓存", () => {
    const registry = new CrossSourceRegistry({ configPath: file });
    expect(registry.listMappings()).toEqual([]);

    registry.replaceMappings([{ ...MAPPING, projectName: " " }]);

    expect(readJson()).toEqual({
      mappings: [
        {
          projectSource: "zentao-cli",
          project: "42",
          repoSource: "gitlab",
          repo: "backend/trading-platform",
        },
      ],
    });
    expect(registry.getCrossSourceLinks("42").repo).toBe(
      "backend/trading-platform"
    );
  });

  it("只替换 mappings，文件内其余同级键（_comment / 旧版 pair）原样保留", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        _comment: "keep me",
        pair: { projectSource: "legacy-ps", repoSource: "legacy-rs" },
        mappings: [],
      })
    );
    const registry = new CrossSourceRegistry({ configPath: file });

    registry.replaceMappings([MAPPING]);

    expect(readJson()).toEqual({
      _comment: "keep me",
      pair: { projectSource: "legacy-ps", repoSource: "legacy-rs" },
      mappings: [MAPPING],
    });
  });

  it("校验失败抛错且不改动原文件与缓存", () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));
    const before = fs.readFileSync(file, "utf-8");
    const registry = new CrossSourceRegistry({ configPath: file });

    expect(() =>
      registry.replaceMappings([{ ...MAPPING, repoSource: "" }])
    ).toThrow("跨源映射校验失败：第 1 条映射：代码仓库侧数据源 id 不能为空");
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
    expect(registry.listMappings()).toEqual([MAPPING]);
  });

  it("原文件不是合法 JSON 时拒绝覆盖（不抹掉手工内容）", () => {
    fs.writeFileSync(file, "{ broken");
    const registry = new CrossSourceRegistry({ configPath: file });

    expect(() => registry.replaceMappings([])).toThrow(/不是合法的 JSON 对象/);
    expect(fs.readFileSync(file, "utf-8")).toBe("{ broken");
  });

  it("未绑定配置文件的实例（initialMappings 构造）无法保存", () => {
    const registry = new CrossSourceRegistry({ initialMappings: [MAPPING] });
    expect(() => registry.replaceMappings([MAPPING])).toThrow(/未绑定配置文件/);
  });

  it("手改文件后免 reload 即生效", () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));
    // 把首版 mtime 拨到过去，避免与随后的改写落在同一时间刻度
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(file, past, past);
    const registry = new CrossSourceRegistry({ configPath: file });
    expect(registry.listMappings()).toHaveLength(1);

    fs.writeFileSync(
      file,
      JSON.stringify({ mappings: [MAPPING, { ...MAPPING, project: "43" }] })
    );

    expect(registry.listMappings()).toHaveLength(2);
    expect(registry.getCrossSourceLinks("43").confidence).toBe("mapped");
  });

  it("文件被删除后降级为空映射", () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(file, past, past);
    const registry = new CrossSourceRegistry({ configPath: file });
    expect(registry.listMappings()).toHaveLength(1);

    fs.unlinkSync(file);

    expect(registry.listMappings()).toEqual([]);
    expect(registry.getCrossSourceLinks("42").confidence).toBe("none");
  });

  it("保存后其它实例读到新清单（实例间靠磁盘状态汇合，不靠进程内通知）", () => {
    fs.writeFileSync(file, JSON.stringify({ mappings: [MAPPING] }));
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(file, past, past);
    const writer = new CrossSourceRegistry({ configPath: file });
    const reader = new CrossSourceRegistry({ configPath: file });
    expect(reader.listMappings()).toHaveLength(1);

    writer.replaceMappings([MAPPING, { ...MAPPING, project: "43" }]);

    expect(reader.listMappings()).toHaveLength(2);
  });
});
