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
 * 维护入口：设置中心的「跨源映射」分区（/api/cross-source），或直接手改文件；
 * 两条路径均经 mtime 热加载生效，无需重启进程。
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
      typeof legacyPair?.repoSource === "string"
        ? legacyPair.repoSource
        : null;

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

export type MappingValidateResult =
  | { ok: true; mappings: MappingEntry[] }
  | { ok: false; errors: string[] };

const MAPPING_REQUIRED_FIELDS = [
  ["projectSource", "项目管理侧数据源 id"],
  ["project", "项目标识"],
  ["repoSource", "代码仓库侧数据源 id"],
  ["repo", "仓库路径"],
] as const;

/**
 * 校验并规范化整份映射清单（界面保存的写入前置）：四个必填字段去空白后非空，
 * projectName 可选（空白视为未填）；同一 (projectSource, project) 只允许出现一次——
 * getCrossSourceLinks 取首条命中，重复会让项目 → 仓库的指向产生歧义。
 * 源 id 是否存在、是否启用不在此校验：映射可先于数据源建立，能力成立与否由
 * resolveCrossSourcePairs 按当时的激活源实时判定。
 */
export function validateMappings(raw: unknown): MappingValidateResult {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["mappings 必须是数组"] };
  }
  const errors: string[] = [];
  const mappings: MappingEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const label = `第 ${index + 1} 条映射`;
    if (!item || typeof item !== "object") {
      errors.push(`${label}：必须是对象`);
      return;
    }
    const e = item as Record<string, unknown>;
    const text = (key: string): string =>
      typeof e[key] === "string" ? (e[key] as string).trim() : "";
    const projectSource = text("projectSource");
    const project = text("project");
    const projectName = text("projectName");
    const repoSource = text("repoSource");
    const repo = text("repo");

    const missing = MAPPING_REQUIRED_FIELDS.filter(
      ([key]) => !text(key)
    ).map(([, name]) => name);
    if (missing.length > 0) {
      errors.push(`${label}：${missing.join("、")} 不能为空`);
      return;
    }
    const dedupeKey = JSON.stringify([projectSource, project]);
    if (seen.has(dedupeKey)) {
      errors.push(
        `${label}：项目 ${project}（源 ${projectSource}）重复映射，同一项目只能对应一个仓库`
      );
      return;
    }
    seen.add(dedupeKey);
    mappings.push({
      projectSource,
      project,
      ...(projectName ? { projectName } : {}),
      repoSource,
      repo,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, mappings };
}

function isEnoent(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * 原子写映射清单（tmp + rename）：只替换 root.mappings，文件内其余同级键
 * （如 _comment、旧版 pair）原样保留。文件不存在按全新文件写入；已存在但不是
 * 合法 JSON 对象时拒绝覆盖，避免抹掉用户手工内容。
 */
function writeMappingsFile(configPath: string, mappings: MappingEntry[]): void {
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root 必须是 JSON 对象");
    }
    root = { ...(parsed as Record<string, unknown>), mappings };
  } catch (err: unknown) {
    if (!isEnoent(err)) {
      throw new Error(
        `跨源映射配置文件不是合法的 JSON 对象，请先修复后再保存: ${configPath}`
      );
    }
    root = { mappings };
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, configPath);
}

/**
 * 跨源映射注册表类（实例隔离，消除全局状态竞争）
 */
export class CrossSourceRegistry {
  private configPath?: string;
  private cache: MappingEntry[] | null = null;
  /** cache 对应的文件 mtime；-1 = 文件不存在 */
  private lastMtimeMs = -1;

  constructor(options?: { configPath?: string; initialMappings?: MappingEntry[] }) {
    if (options?.initialMappings) {
      this.cache = [...options.initialMappings];
    } else {
      this.configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
    }
  }

  /**
   * 配置热加载：文件 mtime 变化即重新解析（手改 JSON 与界面保存均免重启）。
   * 注册表单例在不同路由包里可能是不同的模块实例，各实例靠磁盘状态而非
   * 进程内通知汇合。
   */
  private syncFromDisk(): void {
    const configPath = this.configPath;
    if (!configPath) return;
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(configPath).mtimeMs;
    } catch {
      // 文件不存在或不可读：按空映射处理
    }
    if (this.cache !== null && mtimeMs === this.lastMtimeMs) return;
    this.cache = parseMappingsFromFile(configPath);
    this.lastMtimeMs = mtimeMs;
  }

  private getMappings(): MappingEntry[] {
    this.syncFromDisk();
    return this.cache ?? [];
  }

  /** 全部映射条目（设置界面清单） */
  listMappings(): MappingEntry[] {
    return this.getMappings().map((m) => ({ ...m }));
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

  /**
   * 整份替换映射清单并落盘（设置界面的保存入口）：校验 → 原子写文件 → 刷新本实例
   * 缓存，其它实例经 syncFromDisk 汇合。写入前失败（校验不过 / 文件损坏）不改动
   * 原文件。未绑定配置文件的实例（initialMappings 构造）无法持久化，直接抛错。
   */
  replaceMappings(mappings: MappingEntry[]): MappingEntry[] {
    const verdict = validateMappings(mappings);
    if (!verdict.ok) {
      throw new Error(`跨源映射校验失败：${verdict.errors.join("；")}`);
    }
    const configPath = this.configPath;
    if (!configPath) {
      throw new Error("该跨源映射注册表未绑定配置文件，无法保存");
    }
    writeMappingsFile(configPath, verdict.mappings);
    this.cache = verdict.mappings;
    try {
      this.lastMtimeMs = fs.statSync(configPath).mtimeMs;
    } catch {
      this.lastMtimeMs = -1;
    }
    return verdict.mappings;
  }

  /** 重新加载或切换配置路径 */
  reload(newConfigPath?: string): void {
    if (newConfigPath !== undefined) {
      this.configPath = newConfigPath;
    }
    this.cache = null;
    this.syncFromDisk();
  }
}

/** 默认单例（向后兼容） */
export const defaultCrossSourceRegistry = new CrossSourceRegistry();

/** 兼容旧版顶层导出函数 */
export function listCrossSourcePairs(): CrossSourcePair[] {
  return defaultCrossSourceRegistry.listCrossSourcePairs();
}

export function listMappings(): MappingEntry[] {
  return defaultCrossSourceRegistry.listMappings();
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

/**
 * 整份替换默认注册表的映射清单并落盘（宿主薄壳 /api/cross-source 的保存入口）。
 */
export function replaceMappings(mappings: MappingEntry[]): MappingEntry[] {
  return defaultCrossSourceRegistry.replaceMappings(mappings);
}

export function reloadCrossSourceMap(
  configPath: string = DEFAULT_CONFIG_PATH
): void {
  defaultCrossSourceRegistry.reload(configPath);
}
