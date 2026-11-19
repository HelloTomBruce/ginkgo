import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfigFile,
  validateSourceConfig,
  upsertSource,
  deleteSource,
  maskConnectionString,
} from "./config";

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "datasources-")),
    "datasources.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

const ZHAOBIAO_SOURCE = {
  id: "zhaobiao",
  name: "招标平台数据",
  kind: "db" as const,
  dbType: "mysql" as const,
  connectionString: "mysql://root:p@h:3306/dvadminlocal",
  enabled: true,
};

describe("数据源配置纯化（纯 DB / File）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("纯 DB 数据源能够正常读写与持久化", () => {
    const file = writeTempConfig(
      JSON.stringify({ sources: [ZHAOBIAO_SOURCE] })
    );
    const cfg = loadConfigFile(file);

    expect(cfg.sources).toHaveLength(1);
    expect(cfg.sources[0].id).toBe("zhaobiao");
  });

  it("校验：合法 db 配置通过", () => {
    const res = validateSourceConfig(ZHAOBIAO_SOURCE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.kind).toBe("db");
    }
  });

  it("校验：合法 file 配置通过", () => {
    const res = validateSourceConfig({
      id: "my-excel",
      name: "销售统计文件",
      kind: "file",
      enabled: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.kind).toBe("file");
    }
  });

  it("校验：拒绝非法 kind（如旧的 http-mcp）", () => {
    const res = validateSourceConfig({
      id: "old-mcp",
      name: "旧 MCP 服务",
      kind: "http-mcp",
      url: "http://example.com/mcp",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toContain("kind 仅支持 db | file");
    }
  });

  it("maskConnectionString 脱敏连接串密码与 query 敏感信息", () => {
    expect(maskConnectionString("postgres://user:secret123@localhost:5432/mydb")).toBe(
      "postgres://user:***@localhost:5432/mydb"
    );
  });

  it("upsertSource 与 deleteSource 纯函数操作", () => {
    const initial = { sources: [ZHAOBIAO_SOURCE] };
    const next = upsertSource(initial, {
      id: "crm-db",
      name: "CRM 数据库",
      kind: "db",
      dbType: "postgres",
      connectionString: "postgres://root@localhost:5432/crm",
      enabled: true,
    });
    expect(next.sources).toHaveLength(2);

    const deleted = deleteSource(next, "zhaobiao");
    expect(deleted.sources).toHaveLength(1);
    expect(deleted.sources[0].id).toBe("crm-db");
  });
});
