import type { DbDialect, DbDialectClient } from "./dialect";

export interface DbToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DbToolsConnection {
  listTools(): Promise<DbToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  close(): Promise<void>;
}

/**
 * 原生数据库工具连接装配器：
 * 直接调用 DbDialect 接口（readOnlyQuery / listTables / describeTable），
 * 彻底消除进程内伪 MCP Server (JSON-RPC) 传输开销。
 */
export function createDbToolsConnection(
  dialect: DbDialect,
  client: DbDialectClient,
  sourceName: string
): DbToolsConnection {
  const tools: DbToolDefinition[] = [
    {
      name: "list_tables",
      description: `列出 ${sourceName} 中可查询的数据表`,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "describe_table",
      description: `查看 ${sourceName} 中某张表的列名与类型`,
      inputSchema: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: '数据表名，例如: "orders"',
          },
        },
        required: ["table_name"],
      },
    },
    {
      name: "execute_sql",
      description: `在 ${sourceName} 中安全执行只读 SELECT 查询，用于指标聚合与明细钻取。强制只读事务、5s 超时与行数封顶保护。`,
      inputSchema: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: `标准的 ${dialect.dbType} SELECT 查询，例如: SELECT channel, SUM(amount) FROM orders GROUP BY channel`,
          },
          params: {
            type: "array",
            description:
              "可选参数绑定值（按占位符顺序；位置占位 ? 或命名占位 {pN} 视方言而定），全参数化防注入",
            items: {},
          },
        },
        required: ["sql"],
      },
    },
  ];

  return {
    listTools: async () => tools,
    callTool: async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case "list_tables": {
          try {
            const tables = await dialect.listTables(client);
            return {
              content: [{ type: "text", text: JSON.stringify(tables) }],
            };
          } catch (err: unknown) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return {
              isError: true,
              content: [
                { type: "text", text: `目录查询失败: ${errorMessage}` },
              ],
            };
          }
        }

        case "describe_table": {
          const tableName = (args?.table_name as string) || "";
          try {
            const columns = await dialect.describeTable(client, tableName);
            if (columns.length === 0) {
              return {
                isError: true,
                content: [{ type: "text", text: `未找到数据表: ${tableName}` }],
              };
            }
            return {
              content: [{ type: "text", text: JSON.stringify(columns) }],
            };
          } catch (err: unknown) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return {
              isError: true,
              content: [
                { type: "text", text: `目录查询失败: ${errorMessage}` },
              ],
            };
          }
        }

        case "execute_sql": {
          const sql = (args?.sql as string) || "";
          const rawParams = args?.params;
          const params = Array.isArray(rawParams) ? rawParams : undefined;
          try {
            const result = await dialect.readOnlyQuery(client, sql, params);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    rowCount: result.rowCount,
                    rows: result.rows,
                  }),
                },
              ],
            };
          } catch (err: unknown) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return {
              isError: true,
              content: [{ type: "text", text: `SQL 执行失败: ${errorMessage}` }],
            };
          }
        }

        default:
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
          };
      }
    },
    close: async () => {
      await client.close();
    },
  };
}
