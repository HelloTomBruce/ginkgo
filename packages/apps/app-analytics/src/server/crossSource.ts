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

export interface MappingEntry extends CrossSourcePair {
  project: string;
  projectName?: string;
  repo: string;
}

export const DEFAULT_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "cross-source-map.json"
);

function parseMappingsFromFile(configPath: string): MappingEntry[] {
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

/**
 * 跨源映射注册表类（实例隔离，消除全局状态竞争）
 */
export class CrossSourceRegistry {
  private configPath?: string;
  private cache: MappingEntry[] | null = null;

  constructor(options?: { configPath?: string; initialMappings?: MappingEntry[] }) {
    if (options?.initialMappings) {
      this.cache = [...options.initialMappings];
    } else {
      this.configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
    }
  }

  private getMappings(): MappingEntry[] {
    if (this.cache === null) {
      this.cache = this.configPath ? parseMappingsFromFile(this.configPath) : [];
    }
    return this.cache;
  }

  /** 配置中出现的全部源配对（去重） */
  listCrossSourcePairs(): CrossSourcePair[] {
    const seen = new Map<string, CrossSourcePair>();
    for (const m of this.getMappings()) {
      const key = `${m.projectSource}:${m.repoSource}`;
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
  resolveCrossSourcePairs(activeSourceIds: string[]): CrossSourcePair[] {
    return this.listCrossSourcePairs().filter(
      (p) =>
        activeSourceIds.includes(p.projectSource) &&
        activeSourceIds.includes(p.repoSource)
    );
  }

  /**
   * 查询项目 → 仓库映射（可选限定项目管理侧源，多配对场景消歧）。
   */
  getCrossSourceLinks(
    projectId: string,
    projectSource?: string
  ): CrossSourceLink {
    const hit = this.getMappings().find(
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

  /** 重新加载或切换配置路径 */
  reload(newConfigPath?: string): void {
    if (newConfigPath !== undefined) {
      this.configPath = newConfigPath;
    }
    this.cache = this.configPath ? parseMappingsFromFile(this.configPath) : [];
  }
}

/** 默认单例（向后兼容） */
export const defaultCrossSourceRegistry = new CrossSourceRegistry();

/** 兼容旧版顶层导出函数 */
export function listCrossSourcePairs(): CrossSourcePair[] {
  return defaultCrossSourceRegistry.listCrossSourcePairs();
}

export function resolveCrossSourcePairs(
  activeSourceIds: string[]
): CrossSourcePair[] {
  return defaultCrossSourceRegistry.resolveCrossSourcePairs(activeSourceIds);
}

export function getCrossSourceLinks(
  projectId: string,
  projectSource?: string
): CrossSourceLink {
  return defaultCrossSourceRegistry.getCrossSourceLinks(projectId, projectSource);
}

export function reloadCrossSourceMap(
  configPath: string = DEFAULT_CONFIG_PATH
): void {
  defaultCrossSourceRegistry.reload(configPath);
}
