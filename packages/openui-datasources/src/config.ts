import fs from "node:fs";
import path from "node:path";

/**
 * 数据源配置模型 v3 + 纯函数读写层。
 * 仅认 v3（{ sources: [...] }）；无模块级可变状态，路径与缓存由调用方（manager 实例）持有。
 */

export interface HttpMcpSourceConfig {
  id: string;
  name: string;
  kind: "http-mcp";
  url: string;
  /** @deprecated 推荐使用 headers["Authorization"]，旧配置保留兼容 */
  token?: string;
  /** 请求头配置（键值对，例如 Authorization、自定义标头等） */
  headers?: Record<string, string>;
  /** URL 查询参数配置（键值对，例如 tenant、env 等） */
  params?: Record<string, string>;
  enabled: boolean;
}

export interface DbSourceConfig {
  id: string;
  name: string;
  kind: "db";
  dbType: "postgres" | "mysql" | "sqlite" | "clickhouse";
  /** sqlite 为文件路径（可带 sqlite: 前缀），其余为 URL 形式连接串 */
  connectionString: string;
  enabled: boolean;
}

export interface StdioCliSourceConfig {
  id: string;
  name: string;
  kind: "stdio-cli";
  command: string;
  args?: string[];
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

export type DynamicSourceConfig =
  | HttpMcpSourceConfig
  | DbSourceConfig
  | StdioCliSourceConfig
  | FileSourceConfig;

export interface DatasourcesConfig {
  sources: DynamicSourceConfig[];
}

export type ValidateResult =
  | { ok: true; config: DynamicSourceConfig }
  | { ok: false; errors: string[] };

/** 旧格式兼容：仅取 sources[] 并规范化；其余顶层字段（含历史 v2 builtin 段）静默忽略 */
function normalizeConfig(parsed: unknown): DatasourcesConfig {
  if (!parsed || typeof parsed !== "object") return defaultConfig();
  const o = parsed as Record<string, unknown>;

  const sources: DynamicSourceConfig[] = Array.isArray(o.sources)
    ? o.sources
        .map(normalizeSourceEntry)
        .filter((s): s is DynamicSourceConfig => s !== null)
    : [];

  return { sources };
}

/** 读取配置文件；文件缺失/损坏返回空配置。 */
export function loadConfigFile(configPath: string): DatasourcesConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return defaultConfig();
  }
}

function defaultConfig(): DatasourcesConfig {
  return { sources: [] };
}

/** db 源合法 dbType 集合（配置读写与校验共用） */
export const DB_TYPES = ["postgres", "mysql", "sqlite", "clickhouse"] as const;
export type DbSourceType = (typeof DB_TYPES)[number];

export function isDbType(v: unknown): v is DbSourceType {
  return (
    v === "postgres" || v === "mysql" || v === "sqlite" || v === "clickhouse"
  );
}

export function normalizeStringRecord(
  input: unknown
): Record<string, string> | undefined {
  if (!input) return undefined;
  let obj = input;
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    if (!trimmed) return undefined;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  const res: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === "string") {
      res[key] = val;
    } else if (typeof val === "number" || typeof val === "boolean") {
      res[key] = String(val);
    } else {
      return undefined;
    }
  }
  return res;
}

/** 单个 source 条目规范化，不合法条目丢弃（不抛错） */
function normalizeSourceEntry(entry: unknown): DynamicSourceConfig | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  const enabled = o.enabled === undefined ? true : Boolean(o.enabled);
  if (o.kind === "http-mcp" && typeof o.url === "string" && o.url) {
    const headers = normalizeStringRecord(o.headers);
    const params = normalizeStringRecord(o.params);
    return {
      id,
      name,
      kind: "http-mcp",
      url: o.url,
      ...(typeof o.token === "string" ? { token: o.token } : {}),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...(params && Object.keys(params).length > 0 ? { params } : {}),
      enabled,
    };
  }
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
  if (o.kind === "stdio-cli" && typeof o.command === "string" && o.command) {
    const args = Array.isArray(o.args)
      ? o.args.filter((a): a is string => typeof a === "string")
      : undefined;
    return { id, name, kind: "stdio-cli", command: o.command, args, enabled };
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
const URL_PATTERN = /^https?:\/\//;
const CONN_PATTERN = /^[\w+.-]+:\/\//;

/** 校验并规范化动态源配置（三种 kind 同构入口） */
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

  if (o.kind === "http-mcp") {
    const url = typeof o.url === "string" ? o.url : "";
    if (!URL_PATTERN.test(url)) {
      errors.push("url 必须以 http:// 或 https:// 开头");
    }
    let headers: Record<string, string> | undefined;
    if (o.headers !== undefined && o.headers !== null && o.headers !== "") {
      headers = normalizeStringRecord(o.headers);
      if (!headers) {
        errors.push("headers 必须是合法的 JSON 对象");
      }
    }
    let params: Record<string, string> | undefined;
    if (o.params !== undefined && o.params !== null && o.params !== "") {
      params = normalizeStringRecord(o.params);
      if (!params) {
        errors.push("params 必须是合法的键值对象或 JSON");
      }
    }
    if (errors.length === 0) {
      return {
        ok: true,
        config: {
          id,
          name,
          kind: "http-mcp",
          url,
          enabled,
          ...(typeof o.token === "string" ? { token: o.token } : {}),
          ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
          ...(params && Object.keys(params).length > 0 ? { params } : {}),
        },
      };
    }
  } else if (o.kind === "db") {
    const dbType = isDbType(o.dbType) ? o.dbType : undefined;
    const connectionString =
      typeof o.connectionString === "string" ? o.connectionString.trim() : "";
    if (!dbType) {
      errors.push("dbType 仅支持 postgres | mysql | sqlite | clickhouse");
    }
    // sqlite 连接串是文件路径（sqlite: 前缀或纯路径），其余为 URL 形式
    if (dbType === "sqlite") {
      const p = connectionString.replace(/^sqlite:/, "");
      if (!p || /\s/.test(p)) {
        errors.push("sqlite connectionString 非法（需为数据库文件路径，可带 sqlite: 前缀）");
      } else if (p === ":memory:" || p.startsWith("file::memory:")) {
        // 内存库对持久分析源无意义：连接关闭即丢数据，且结构卡/只读语义均不成立
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
  } else if (o.kind === "stdio-cli") {
    const command = typeof o.command === "string" ? o.command.trim() : "";
    if (!command) errors.push("command 不能为空");
    const rawArgs = Array.isArray(o.args) ? o.args : [];
    if (rawArgs.some((a) => typeof a !== "string")) {
      errors.push("args 必须是字符串数组");
    }
    if (command && errors.length === 0) {
      const args = rawArgs.map(String).filter((a) => a.length > 0);
      return {
        ok: true,
        config: { id, name, kind: "stdio-cli", command, args, enabled },
      };
    }
  } else if (o.kind === "file") {
    if (errors.length === 0) {
      return { ok: true, config: { id, name, kind: "file", enabled } };
    }
  } else {
    errors.push("kind 仅支持 http-mcp | db | stdio-cli | file");
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

/** query 中视为机密的参数名（大小写不敏感） */
const SENSITIVE_QUERY_KEYS =
  /^(?:pass(?:word)?|pwd|secret|token|access_?key|api_?key|auth)$/i;

/** header 中视为机密的名称（大小写不敏感） */
const SENSITIVE_HEADER_KEYS =
  /^(?:authorization|cookie|proxy-authorization)$|token|secret|api[_-]?key|password|pwd/i;

/** 无法解析的连接串统一回显的占位符；客户端以含 *** 判定「未变更」 */
export const MASKED_PLACEHOLDER = "***";

/**
 * 脱敏 headers：敏感标头（Authorization、Token 等）值替换为 ***。
 */
export function maskHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_KEYS.test(k)) {
      result[k] = MASKED_PLACEHOLDER;
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * 脱敏 params：URL 查询参数同样常携带凭证（api_key/token 等），
 * 按 SENSITIVE_QUERY_KEYS 规则脱敏，与 maskUrl 的口径一致。
 */
export function maskParams(
  params: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    result[k] = SENSITIVE_QUERY_KEYS.test(k) ? MASKED_PLACEHOLDER : v;
  }
  return result;
}

/**
 * 脱敏连接串：隐藏 userinfo 密码与 password 类 query 参数。
 * 解析失败（如键值 DSN `Host=..;Password=..`）一律回退占位符——
 * 绝不把可能含明文密码的原文下发到客户端。
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

/** 脱敏 URL：去 query 与 userinfo，仅保留 protocol//host/pathname */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}
