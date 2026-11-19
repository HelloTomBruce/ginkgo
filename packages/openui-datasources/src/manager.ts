import fs from "node:fs";
import path from "node:path";
import { DIALECTS, type DbDialectClient } from "./connectors/db/dialect";
import { duckdbDialect } from "./connectors/db/duckdbDialect";
import { createDbToolsConnection, type DbToolsConnection } from "./connectors/db/dbTools";
import { QueryCacheManager } from "./gateway/queryCache";
import { executeSqlWithGuards } from "./gateway/queryPipeline";
import { McpGateway } from "./gateway/mcpGateway";
import type { ExplainOptions } from "./gateway/types";
import {
  readManifest,
  duckDbPath,
  ingestSourceFiles,
  removeSourceFiles,
  type FileSourceManifest,
  type FileSourceUpload,
} from "./connectors/file/fileStore";
import { parseMcpToolResult } from "./parseToolResult";
import {
  collectSchemaCard,
  type SchemaCard,
  type SchemaProbe,
} from "./schema/card";
import { createSchemaCardLifecycle } from "./schema/cardLifecycle";
import {
  loadConfigFile,
  writeConfigFile,
  validateSourceConfig,
  upsertSource,
  deleteSource,
  maskConnectionString,
  type DbSourceType,
  type DynamicSourceConfig,
  type DatasourcesConfig,
  type ValidateResult,
} from "./config";

export interface DataSourceDescriptor {
  id: string;
  name: string;
  kind: "db" | "file";
  tools: string[];
  enabled: boolean;
  dbType?: DbSourceType;
  maskedConnectionString?: string;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ActiveSourceSummary {
  id: string;
  name: string;
  kind: DataSourceDescriptor["kind"];
  dbType?: DbSourceType;
  tools: string[];
}

export type McpConnection = DbToolsConnection;

export interface McpToolBinding {
  name: string;
  originalName: string;
  description?: string;
  inputSchema?: unknown;
  call(args: Record<string, unknown>): Promise<unknown>;
}

export interface DatasourceManager {
  readConfig(): DatasourcesConfig;
  writeConfig(c: DatasourcesConfig): void;
  validate(s: DynamicSourceConfig): ValidateResult;
  upsert(s: DynamicSourceConfig): DatasourcesConfig;
  delete(id: string): DatasourcesConfig;
  get(id: string): DynamicSourceConfig | undefined;
  list(): DataSourceDescriptor[];
  connect(s: DynamicSourceConfig): Promise<McpConnection>;
  tools(s: DynamicSourceConfig): Promise<McpToolBinding[]>;
  close(id: string): Promise<void>;
  health(s: DynamicSourceConfig): Promise<HealthResult>;
  resolveActive(ids: string[] | undefined): ActiveSourceSummary[];
  ingestFiles(
    id: string,
    uploads: FileSourceUpload[]
  ): Promise<FileSourceManifest>;
  filesManifest(id: string): Promise<FileSourceManifest | null>;
  removeFiles(id: string): Promise<void>;
  getSchemaCard(id: string): Promise<{ card: SchemaCard; stale: boolean } | null>;
  refreshSchemaCard(id: string): Promise<void>;
  getDialectClient?(id: string): { client: DbDialectClient; dbType: string } | undefined;
  getQueryCache?(): QueryCacheManager<unknown>;
  gateway?: McpGateway;
}

const DB_SOURCE_TOOLS = ["execute_sql", "list_tables", "describe_table"];

const SCHEMA_MISS_RE =
  /column .{0,64}(does not exist|not found)|unknown column|no such column|unknown identifier|binder error|there is no column|doesn't exist/i;

interface ConnCacheEntry {
  key: string;
  connection: McpConnection;
  bindings?: McpToolBinding[];
  dialectClient?: {
    client: DbDialectClient;
    dbType: string;
  };
}

function configKey(source: DynamicSourceConfig): string {
  if (source.kind === "db")
    return JSON.stringify(["db", source.dbType, source.connectionString]);
  return JSON.stringify(["file", source.id]);
}

export interface CreateDatasourceManagerOptions {
  configPath: string;
  filesDir?: string;
  schemaCardsDir?: string;
  maxCacheEntries?: number;
  defaultCacheTtlMs?: number;
  explainOptions?: ExplainOptions;
}

export function describeDynamicSource(
  s: DynamicSourceConfig
): DataSourceDescriptor {
  if (s.kind === "db") {
    return {
      id: s.id,
      name: s.name,
      kind: "db",
      tools: DB_SOURCE_TOOLS,
      enabled: s.enabled,
      dbType: s.dbType,
      maskedConnectionString: maskConnectionString(s.connectionString),
    };
  }
  return {
    id: s.id,
    name: s.name,
    kind: "file",
    tools: DB_SOURCE_TOOLS,
    enabled: s.enabled,
  };
}

export function createDatasourceManager(
  opts: CreateDatasourceManagerOptions
): DatasourceManager {
  const { configPath } = opts;
  const filesDir =
    opts.filesDir ?? path.join(path.dirname(configPath), "..", "data", "files");
  const schemaCardsDir =
    opts.schemaCardsDir ??
    path.join(path.dirname(configPath), "..", "data", "schema-cards");

  let configCache: DatasourcesConfig | null = null;
  let lastMtimeMs = 0;
  const connCache = new Map<string, ConnCacheEntry>();

  const queryCache = new QueryCacheManager<unknown>({
    maxEntries: opts.maxCacheEntries ?? 500,
    defaultTtlMs: opts.defaultCacheTtlMs ?? 15 * 60 * 1000,
  });

  const ingestChains = new Map<string, Promise<unknown>>();

  const callJson = async (
    connection: McpConnection,
    tool: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    const res = await connection.callTool(tool, args);
    return parseMcpToolResult(res, `schema-card ${tool}`);
  };

  const buildCardForSource = async (
    source: DynamicSourceConfig
  ): Promise<SchemaCard> => {
    const connection =
      source.kind === "db"
        ? (await connectDbSource(source)).connection
        : (await connectFileSource(source, filesDir)).connection;

    try {
      const probe: SchemaProbe = {
        listTables: async () => {
          const raw = (await callJson(connection, "list_tables", {})) as unknown;
          if (Array.isArray(raw)) {
            return raw.map((item) =>
              typeof item === "string" ? { table: item } : (item as { table: string })
            );
          }
          return [];
        },
        describeTable: async (table) => {
          const raw = (await callJson(connection, "describe_table", {
            table_name: table,
          })) as unknown;
          if (Array.isArray(raw)) {
            return raw.map((item) => {
              const rec = item as Record<string, unknown>;
              return {
                column: String(rec.column ?? rec.name ?? ""),
                type: String(rec.type ?? ""),
              };
            });
          }
          return [];
        },
        query: async (sql) => {
          const res = (await callJson(connection, "execute_sql", { sql })) as {
            rows?: Record<string, unknown>[];
          };
          return res.rows ?? [];
        },
      };

      const quoteIdent =
        source.kind === "db" && source.dbType === "mysql"
          ? (name: string) => `\`${name.replace(/`/g, "``")}\``
          : (name: string) => `"${name.replace(/"/g, '""')}"`;

      return await collectSchemaCard({ sourceId: source.id, probe, quoteIdent });
    } finally {
      await connection.close().catch(() => {});
    }
  };

  const cardLifecycle = createSchemaCardLifecycle({
    cardsDir: schemaCardsDir,
    buildCard: buildCardForSource,
  });

  const readConfig = (): DatasourcesConfig => {
    try {
      const stat = fs.statSync(configPath);
      if (configCache === null || stat.mtimeMs !== lastMtimeMs) {
        configCache = loadConfigFile(configPath);
        lastMtimeMs = stat.mtimeMs;
      }
    } catch {
      if (configCache === null) {
        configCache = loadConfigFile(configPath);
      }
    }
    return configCache ?? { sources: [] };
  };

  const writeConfig = (c: DatasourcesConfig): void => {
    writeConfigFile(c, configPath);
    configCache = c;
    try {
      lastMtimeMs = fs.statSync(configPath).mtimeMs;
    } catch {
      lastMtimeMs = Date.now();
    }
  };

  function get(id: string): DynamicSourceConfig | undefined {
    return readConfig().sources.find((s) => s.id === id);
  }

  function list(): DataSourceDescriptor[] {
    return readConfig().sources.map((s) => {
      if (s.kind === "db") {
        return {
          id: s.id,
          name: s.name,
          kind: "db",
          tools: DB_SOURCE_TOOLS,
          enabled: s.enabled,
          dbType: s.dbType,
          maskedConnectionString: maskConnectionString(s.connectionString),
        };
      }
      return {
        id: s.id,
        name: s.name,
        kind: "file",
        tools: DB_SOURCE_TOOLS,
        enabled: s.enabled,
      };
    });
  }

  async function connectDbSource(
    source: Extract<DynamicSourceConfig, { kind: "db" }>
  ): Promise<{ connection: McpConnection; dialectClient: { client: DbDialectClient; dbType: string } }> {
    const dialect = DIALECTS[source.dbType];
    if (!dialect) {
      throw new Error(`[Datasources] 不支持的数据库方言: ${source.dbType}`);
    }
    const client = await dialect.connect(source.connectionString);
    const connection = createDbToolsConnection(dialect, client, source.name);
    return { connection, dialectClient: { client, dbType: dialect.dbType } };
  }

  async function connectFileSource(
    source: Extract<DynamicSourceConfig, { kind: "file" }>,
    baseDir: string
  ): Promise<{ connection: McpConnection; dialectClient: { client: DbDialectClient; dbType: string } }> {
    const manifest = await readManifest(baseDir, source.id);
    if (!manifest || manifest.files.length === 0) {
      throw new Error("尚未上传文件");
    }
    const dbFile = duckDbPath(baseDir, source.id);
    const client = await duckdbDialect.connect(dbFile);
    const connection = createDbToolsConnection(duckdbDialect, client, source.name);
    return { connection, dialectClient: { client, dbType: duckdbDialect.dbType } };
  }

  async function connect(s: DynamicSourceConfig): Promise<McpConnection> {
    const key = configKey(s);
    const existing = connCache.get(s.id);
    if (existing && existing.key === key) {
      return existing.connection;
    }
    if (existing) {
      await close(s.id);
    }

    if (s.kind === "db") {
      const { connection, dialectClient } = await connectDbSource(s);
      connCache.set(s.id, { key, connection, dialectClient });
      return connection;
    }

    const { connection, dialectClient } = await connectFileSource(s, filesDir);
    connCache.set(s.id, { key, connection, dialectClient });
    return connection;
  }

  async function tools(s: DynamicSourceConfig): Promise<McpToolBinding[]> {
    const key = configKey(s);
    const cached = connCache.get(s.id);
    if (cached && cached.key === key && cached.bindings) {
      return cached.bindings;
    }

    const conn = await connect(s);
    const rawTools = await conn.listTools();

    const bindings: McpToolBinding[] = rawTools.map((t) => ({
      name: `${s.id}_${t.name}`,
      originalName: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      call: async (args: Record<string, unknown>) => {
        const isSqlExecution =
          (t.name === "execute_sql" || t.name === "read_query") &&
          typeof args.sql === "string";

        if (isSqlExecution) {
          const { data } = await executeSqlWithGuards({
            sourceId: s.id,
            sql: (args.sql as string).trim(),
            params: Array.isArray(args.params)
              ? (args.params as unknown[])
              : undefined,
            skipCache: Boolean(args.skipCache),
            bypassExplain: Boolean(args.bypassExplain),
            cacheTtlMs:
              typeof args.cacheTtlMs === "number"
                ? (args.cacheTtlMs as number)
                : undefined,
            dialectClient: connCache.get(s.id)?.dialectClient,
            cache: queryCache,
            explainOptions: opts.explainOptions,
            execute: async () => {
              const res = await conn.callTool(t.name, args);
              try {
                return parseMcpToolResult(res, `tool ${t.name}`);
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                if (SCHEMA_MISS_RE.test(message)) {
                  cardLifecycle.invalidate(s);
                }
                throw err;
              }
            },
          });
          return data;
        }

        const res = await conn.callTool(t.name, args);
        try {
          return parseMcpToolResult(res, `tool ${t.name}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (SCHEMA_MISS_RE.test(message)) {
            cardLifecycle.invalidate(s);
          }
          throw err;
        }
      },
    }));

    const entry = connCache.get(s.id);
    if (entry) {
      entry.bindings = bindings;
    }

    return bindings;
  }

  async function close(id: string): Promise<void> {
    const entry = connCache.get(id);
    if (!entry) return;
    connCache.delete(id);
    try {
      await entry.connection.close();
    } catch {
      // 忽略关闭失败
    }
  }

  async function health(s: DynamicSourceConfig): Promise<HealthResult> {
    const start = Date.now();
    try {
      if (s.kind === "file") {
        const manifest = await filesManifest(s.id);
        const ok = Boolean(manifest && manifest.files.length > 0);
        return {
          ok,
          latencyMs: Date.now() - start,
          error: ok ? undefined : "尚未上传文件",
        };
      }

      const conn = await connect(s);
      await conn.callTool("list_tables", {});
      return {
        ok: true,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function resolveActive(ids: string[] | undefined): ActiveSourceSummary[] {
    const all = readConfig().sources.filter((s) => s.enabled);
    const enabled = new Map<string, ActiveSourceSummary>();
    for (const s of all) {
      enabled.set(s.id, {
        id: s.id,
        name: s.name,
        kind: s.kind,
        dbType: s.kind === "db" ? s.dbType : undefined,
        tools: DB_SOURCE_TOOLS,
      });
    }
    if (ids === undefined) return [...enabled.values()];
    return ids.flatMap((id) => {
      const hit = enabled.get(id);
      if (hit) return [hit];
      console.warn(`[datasources] 忽略未知或未启用的数据源 id: ${id}`);
      return [];
    });
  }

  async function ingestFiles(
    id: string,
    uploads: FileSourceUpload[]
  ): Promise<FileSourceManifest> {
    queryCache.invalidate(id);
    const source = readConfig().sources.find((s) => s.id === id);
    if (!source) throw new Error(`数据源不存在: ${id}`);
    if (source.kind !== "file") {
      throw new Error(`数据源 ${id} 不是文件类型（kind=${source.kind}）`);
    }

    const prev = ingestChains.get(id) ?? Promise.resolve();
    const task = prev.catch(() => {}).then(async () => {
      await close(id);
      const manifest = await ingestSourceFiles(filesDir, id, uploads);
      cardLifecycle.invalidate(source);
      return manifest;
    });

    ingestChains.set(id, task);
    try {
      return (await task) as FileSourceManifest;
    } finally {
      if (ingestChains.get(id) === task) ingestChains.delete(id);
    }
  }

  async function filesManifest(id: string): Promise<FileSourceManifest | null> {
    return readManifest(filesDir, id);
  }

  async function removeFiles(id: string): Promise<void> {
    await close(id);
    await removeSourceFiles(filesDir, id);
  }

  const managerInstance: DatasourceManager = {
    readConfig,
    writeConfig,
    validate: validateSourceConfig,
    upsert: (s) => {
      const next = upsertSource(readConfig(), s);
      writeConfig(next);
      return next;
    },
    delete: (id) => {
      queryCache.invalidate(id);
      close(id).catch(() => {});
      const next = deleteSource(readConfig(), id);
      writeConfig(next);
      cardLifecycle.drop(id);
      return next;
    },
    get,
    list,
    connect,
    tools,
    close,
    health,
    resolveActive,
    ingestFiles,
    filesManifest,
    removeFiles,
    getSchemaCard: (id) => cardLifecycle.get(id),
    refreshSchemaCard: (id) => {
      const source = readConfig().sources.find((s) => s.id === id);
      if (!source) return Promise.reject(new Error(`数据源不存在: ${id}`));
      return cardLifecycle.refresh(source);
    },
    getDialectClient: (id) => connCache.get(id)?.dialectClient,
    getQueryCache: () => queryCache,
  };

  managerInstance.gateway = new McpGateway(
    managerInstance,
    { explainOptions: opts.explainOptions },
    queryCache
  );

  return managerInstance;
}

export function mergeToolSets(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  sourceId: string
): void {
  for (const [name, t] of Object.entries(incoming)) {
    if (name in target) {
      console.warn(`[datasources] 工具名冲突，跳过 ${name}（来自 ${sourceId}）`);
      continue;
    }
    target[name] = t;
  }
}

