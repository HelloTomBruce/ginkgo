import fs from "node:fs";
import path from "node:path";

/**
 * 跨源联合分析映射配置（完全由用户维护，代码不内置任何数据源名）。
 *
 * 配置文件：config/cross-source-map.json，结构：
 * ```json
 * {
 *   "mappings": [
 *     {
 *       "projectSource": "zentao-cli",       // 项目管理侧数据源 id（datasources.json 里自建的 id）
 *       "project": "42",                     // 该侧的项目标识
 *       "projectName": "交易平台重构",        // 可选展示名
 *       "repoSource": "gitlab",              // 代码仓库侧数据源 id
 *       "repo": "backend/trading-platform"   // 该侧的仓库路径
 *     }
 *   ]
 * }
 * ```
 *
 * 能力成立条件（没有独立的「是否跨源」开关）：
 *   存在至少一条映射，且其 projectSource / repoSource 都在当前激活源集合内。
 *   会话级取消勾选某一侧源，跨源能力对该会话即自动关闭。
 *
 * 兼容：旧版顶层 pair + zentaoProjectId/gitlabProject 字段名的条目仍可读，
 * 源 id 从顶层 pair 补齐。
 */

export interface CrossSourcePair {
  /** 项目管理侧数据源 id */
  projectSource: string;
  /** 代码仓库侧数据源 id */
  repoSource: string;
}

export interface CrossSourceLink {
  repo: string | null;
  repoSource?: string;
  confidence: "mapped" | "none";
  projectName?: string;
}

interface MappingEntry extends CrossSourcePair {
  project: string;
  projectName?: string;
  repo: string;
}

const DEFAULT_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "cross-source-map.json"
);

let cache: MappingEntry[] | null = null;
let cachePath = DEFAULT_CONFIG_PATH;

function load(configPath: string): MappingEntry[] {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as Record<string, unknown>;

    // 旧版顶层 pair：给旧格式条目补齐源 id
    const legacyPair = obj.pair as Record<string, unknown> | undefined;
    const legacyProjectSource =
      typeof legacyPair?.projectSource === "string"
        ? legacyPair.projectSource
        : null;
    const legacyRepoSource =
      typeof legacyPair?.repoSource === "string" ? legacyPair.repoSource : null;

    const rawMappings = Array.isArray(obj.mappings) ? obj.mappings : [];
    const mappings: MappingEntry[] = [];
    for (const m of rawMappings) {
      if (!m || typeof m !== "object") continue;
      const e = m as Record<string, unknown>;
      const projectSource = e.projectSource ?? legacyProjectSource;
      const repoSource = e.repoSource ?? legacyRepoSource;
      const project = e.project ?? e.zentaoProjectId;
      const repo = e.repo ?? e.gitlabProject;
      const projectName = e.projectName ?? e.zentaoProjectName;
      if (
        typeof projectSource !== "string" ||
        typeof repoSource !== "string" ||
        typeof project !== "string" ||
        typeof repo !== "string"
      ) {
        continue;
      }
      mappings.push({
        projectSource,
        repoSource,
        project,
        repo,
        ...(typeof projectName === "string" ? { projectName } : {}),
      });
    }
    return mappings;
  } catch {
    return [];
  }
}

function mappings(): MappingEntry[] {
  if (cache === null) cache = load(cachePath);
  return cache;
}

/** 配置中出现的全部源配对（去重） */
export function listCrossSourcePairs(): CrossSourcePair[] {
  const seen = new Map<string, CrossSourcePair>();
  for (const m of mappings()) {
    const key = `${m.projectSource}${m.repoSource}`;
    if (!seen.has(key)) {
      seen.set(key, {
        projectSource: m.projectSource,
        repoSource: m.repoSource,
      });
    }
  }
  return [...seen.values()];
}

/**
 * 解析当前激活源集合下成立的源配对：
 * 映射存在且双侧源都激活的配对才会返回；空数组 = 跨源能力关闭。
 */
export function resolveCrossSourcePairs(
  activeSourceIds: string[]
): CrossSourcePair[] {
  return listCrossSourcePairs().filter(
    (p) =>
      activeSourceIds.includes(p.projectSource) &&
      activeSourceIds.includes(p.repoSource)
  );
}

/**
 * 查询项目 → 仓库映射（可选限定项目管理侧源，多配对场景消歧）。
 */
export function getCrossSourceLinks(
  projectId: string,
  projectSource?: string
): CrossSourceLink {
  const hit = mappings().find(
    (m) =>
      m.project === projectId &&
      (projectSource === undefined || m.projectSource === projectSource)
  );
  if (hit) {
    return {
      repo: hit.repo,
      repoSource: hit.repoSource,
      confidence: "mapped",
      projectName: hit.projectName,
    };
  }
  return { repo: null, confidence: "none" };
}

/**
 * 重新加载映射配置（配置变更后调用；测试可传入临时路径）。
 */
export function reloadCrossSourceMap(
  configPath: string = DEFAULT_CONFIG_PATH
): void {
  cachePath = configPath;
  cache = load(cachePath);
}
