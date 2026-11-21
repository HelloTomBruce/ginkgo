// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getCrossSourceLinks,
  listCrossSourcePairs,
  resolveCrossSourcePairs,
  reloadCrossSourceMap,
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
