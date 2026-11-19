import fs from "node:fs";
import path from "node:path";

/**
 * 数据源配置模型：专注于结构化数据（数据库连接与分析文件）
 * 彻底纯化，网络/外设 MCP 协议统一由 @openui-analytics/harness-core 承接。
 */

export interface DbSourceConfig {
  id: string;
  name: string;
  kind: "db";
  dbType: "postgres" | "mysql" | "sqlite" | "clickhouse";
  /** sqlite 为文件路径（可带 sqlite: 前缀），其余为 URL 形式连接串 */
  connectionString: string;
  enabled: boolean;
}

/**
 * 文件数据源（CSV/Excel）：无连接串等额外字段；
 * 文件内容与 DuckDB 库落盘在应用注入的 filesDir 下，配置层只持有元信息。
 */
export interface FileSourceConfig {
  id: string;
  name: string;
  kind: "file";
  enabled: boolean;
}

export type DynamicSourceConfig = DbSourceConfig | FileSourceConfig;

export interface DatasourcesConfig {
  sources: DynamicSourceConfig[];
}

export type DbSourceType = DbSourceConfig["dbType"];

const DB_TYPES: readonly DbSourceType[] = [
  "postgres",
  "mysql",
  "sqlite",
  "clickhouse",
] as const;

export function isDbType(v: unknown): v is DbSourceType {
  return typeof v === "string" && (DB_TYPES as readonly string[]).includes(v);
}

/**
 * 从 JSON 读取配置：文件缺失返回空配置（{ sources: [] }）；格式非法抛错。
 */
export function loadConfigFile(target: string): DatasourcesConfig {
  let content = "";
  try {
    content = fs.readFileSync(target, "utf-8");
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return { sources: [] };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`配置文件非法 JSON: ${target}`);
  }
  return parseDatasourcesConfig(parsed, target);
}

function parseDatasourcesConfig(
  raw: unknown,
  target: string
): DatasourcesConfig {
  if (!raw || typeof raw !== "object" || !("sources" in raw)) {
    throw new Error(`配置文件格式非法（必须包含 sources 数组）: ${target}`);
  }
  const sourcesRaw = (raw as { sources: unknown }).sources;
  if (!Array.isArray(sourcesRaw)) {
    throw new Error(`配置文件 sources 必须是数组: ${target}`);
  }
  const sources: DynamicSourceConfig[] = [];
  const seenIds = new Set<string>();
  for (const item of sourcesRaw) {
    const parsed = parseDynamicSource(item);
    if (!parsed) continue;
    if (seenIds.has(parsed.id)) {
      throw new Error(`配置文件含重复 source id "${parsed.id}": ${target}`);
    }
    seenIds.add(parsed.id);
    sources.push(parsed);
  }
  return { sources };
}

function parseDynamicSource(raw: unknown): DynamicSourceConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  const enabled = o.enabled === undefined ? true : Boolean(o.enabled);

  if (
    o.kind === "db" &&
    isDbType(o.dbType) &&
    typeof o.connectionString === "string" &&
    o.connectionString
  ) {
    return {
      id,
      name,
      kind: "db",
      dbType: o.dbType,
      connectionString: o.connectionString,
      enabled,
    };
  }
  if (o.kind === "file") {
    return { id, name, kind: "file", enabled };
  }
  return null;
}

/** 原子写：tmp + rename；同步 fs 调用单进程内天然串行 */
export function writeConfigFile(
  config: DatasourcesConfig,
  target: string
): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, target);
}

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const CONN_PATTERN = /^[\w+.-]+:\/\//;

export type ValidateResult =
  | { ok: true; config: DynamicSourceConfig }
  | { ok: false; errors: string[] };

/** 校验并规范化数据源配置（只支持 db | file） */
export function validateSourceConfig(input: unknown): ValidateResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["配置必须是对象"] };
  }
  const o = input as Record<string, unknown>;

  const id = typeof o.id === "string" ? o.id : "";
  if (!SOURCE_ID_PATTERN.test(id)) {
    errors.push(`id 非法（需匹配 ^[a-z][a-z0-9-]{0,31}$）: "${id}"`);
  }

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) errors.push("name 不能为空");

  const enabled = o.enabled === undefined ? true : Boolean(o.enabled);

  if (o.kind === "db") {
    const dbType = isDbType(o.dbType) ? o.dbType : undefined;
    const connectionString =
      typeof o.connectionString === "string" ? o.connectionString.trim() : "";
    if (!dbType) {
      errors.push("dbType 仅支持 postgres | mysql | sqlite | clickhouse");
    }
    if (dbType === "sqlite") {
      const p = connectionString.replace(/^sqlite:/, "");
      if (!p || /\s/.test(p)) {
        errors.push("sqlite connectionString 非法（需为数据库文件路径，可带 sqlite: 前缀）");
      } else if (p === ":memory:" || p.startsWith("file::memory:")) {
        errors.push("sqlite 不支持内存库（:memory:），请提供持久化的数据库文件路径");
      }
    } else if (!CONN_PATTERN.test(connectionString)) {
      errors.push("connectionString 连接串非法（需 URL 形式且不能为空）");
    }
    if (dbType && errors.length === 0) {
      return {
        ok: true,
        config: { id, name, kind: "db", dbType, connectionString, enabled },
      };
    }
  } else if (o.kind === "file") {
    if (errors.length === 0) {
      return { ok: true, config: { id, name, kind: "file", enabled } };
    }
  } else {
    errors.push("kind 仅支持 db | file");
  }

  return { ok: false, errors };
}

/** 新增或覆盖动态源（同 id 覆盖）；纯函数，返回新配置对象 */
export function upsertSource(
  config: DatasourcesConfig,
  source: DynamicSourceConfig
): DatasourcesConfig {
  const sources = [...config.sources];
  const idx = sources.findIndex((s) => s.id === source.id);
  if (idx >= 0) sources[idx] = source;
  else sources.push(source);
  return { sources };
}

/** 删除动态源；纯函数，返回新配置对象（不存在时内容不变） */
export function deleteSource(
  config: DatasourcesConfig,
  id: string
): DatasourcesConfig {
  return { sources: config.sources.filter((s) => s.id !== id) };
}

const SENSITIVE_QUERY_KEYS =
  /^(?:pass(?:word)?|pwd|secret|token|access_?key|api_?key|auth)$/i;

export const MASKED_PLACEHOLDER = "***";

/**
 * 脱敏连接串：隐藏 userinfo 密码与 password 类 query 参数。
 */
export function maskConnectionString(conn: string): string {
  try {
    const u = new URL(conn);
    if (u.password) u.password = "***";
    u.searchParams.forEach((_, key) => {
      if (SENSITIVE_QUERY_KEYS.test(key)) u.searchParams.set(key, "***");
    });
    return u.toString();
  } catch {
    return MASKED_PLACEHOLDER;
  }
}
