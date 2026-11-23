import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createDatasourceManager } from "./manager";

describe("DatasourceManager + MCP Gateway 隐形升级透明接入验证", () => {
  let tmpDir: string;
  let configPath: string;
  let filesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manager-gw-test-"));
    configPath = path.join(tmpDir, "datasources.json");
    filesDir = path.join(tmpDir, "files");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("透明接入：SQL 执行自动享受规范化哈希与结果集 KV 缓存", async () => {
    const manager = createDatasourceManager({
      configPath,
      filesDir,
      defaultCacheTtlMs: 60000,
    });

    const CSV = Buffer.from("id,name,amount\n1,Alice,100\n2,Bob,200\n", "utf-8");
    manager.upsert({
      id: "sales_csv",
      name: "销售文件源",
      kind: "file",
      enabled: true,
    });
    await manager.ingestFiles("sales_csv", [{ name: "sales.csv", data: CSV }]);

    const source = manager.get("sales_csv")!;
    const tools = await manager.tools(source);
    const sqlTool = tools.find((t) => t.originalName === "execute_sql");
    expect(sqlTool).toBeDefined();

    // 第一次调用：执行真实 DuckDB 查询
    const res1 = (await sqlTool!.call({
      sql: "SELECT sum(amount) AS total FROM sales",
    })) as { rows?: Record<string, unknown>[] };
    expect(res1.rows).toEqual([{ total: 300 }]);

    // 第二次调用：轻微改变换行与多余空格，归一化指纹一致
    const res2 = (await sqlTool!.call({
      sql: "  select  sum(amount) as total \n  from  sales; ",
    })) as { rows?: Record<string, unknown>[] };
    expect(res2.rows).toEqual([{ total: 300 }]);

    // 验证内部 queryCache 中已经存入该查询结果
    const cache = manager.getQueryCache?.();
    expect(cache).toBeDefined();
    expect(cache!.size()).toBeGreaterThanOrEqual(1);
  });

  it("安全守卫拦截：尝试写入或破坏性 SQL 在到达数仓前被词法断言拦截", async () => {
    const manager = createDatasourceManager({ configPath, filesDir });
    const CSV = Buffer.from("id,val\n1,10\n", "utf-8");
    manager.upsert({
      id: "csv_safe",
      name: "测试源",
      kind: "file",
      enabled: true,
    });
    await manager.ingestFiles("csv_safe", [{ name: "t.csv", data: CSV }]);

    const tools = await manager.tools(manager.get("csv_safe")!);
    const sqlTool = tools.find((t) => t.originalName === "execute_sql")!;

    // 尝试执行 DROP TABLE 危险操作
    await expect(
      sqlTool.call({ sql: "DROP TABLE t" })
    ).rejects.toThrow(/安全限制|仅允许 SELECT/i);

    // 尝试执行 INSERT INTO 操作
    await expect(
      sqlTool.call({ sql: "INSERT INTO t VALUES (2, 20)" })
    ).rejects.toThrow(/安全限制|仅允许 SELECT/i);
  });

  it("数据更新联动：重新上传文件时，自动淘汰旧数据的查询缓存", async () => {
    const manager = createDatasourceManager({ configPath, filesDir });
    manager.upsert({
      id: "inv_source",
      name: "库存源",
      kind: "file",
      enabled: true,
    });

    // 灌入初始版本数据
    const V1 = Buffer.from("sku,stock\nA,50\n", "utf-8");
    await manager.ingestFiles("inv_source", [{ name: "inv.csv", data: V1 }]);

    const tools1 = await manager.tools(manager.get("inv_source")!);
    const exec1 = tools1.find((t) => t.originalName === "execute_sql")!;

    const r1 = (await exec1.call({
      sql: "SELECT stock FROM inv WHERE sku = 'A'",
    })) as { rows?: Record<string, unknown>[] };
    expect(r1.rows).toEqual([{ stock: 50 }]);

    // 重新灌入新版本数据 (stock 改为 999)
    const V2 = Buffer.from("sku,stock\nA,999\n", "utf-8");
    await manager.ingestFiles("inv_source", [{ name: "inv.csv", data: V2 }]);

    // 重新获取工具并执行相同 SQL
    const tools2 = await manager.tools(manager.get("inv_source")!);
    const exec2 = tools2.find((t) => t.originalName === "execute_sql")!;

    const r2 = (await exec2.call({
      sql: "SELECT stock FROM inv WHERE sku = 'A'",
    })) as { rows?: Record<string, unknown>[] };

    // 缓存被成功淘汰，读到最新数据 999 而非旧缓存 50
    expect(r2.rows).toEqual([{ stock: 999 }]);
  });

  it("manager 实例直接暴露 gateway 实例与 getDialectClient 接口", async () => {
    const manager = createDatasourceManager({ configPath, filesDir });
    expect(manager.gateway).toBeDefined();
    expect(typeof manager.getDialectClient).toBe("function");
    expect(typeof manager.getQueryCache).toBe("function");
  });

  it("共享缓存一致性：manager 与 gateway 同一缓存实例，灌库失效对 gateway 路径同样生效", async () => {
    const manager = createDatasourceManager({ configPath, filesDir });
    manager.upsert({
      id: "shared_src",
      name: "共享缓存源",
      kind: "file",
      enabled: true,
    });

    const V1 = Buffer.from("sku,stock\nA,50\n", "utf-8");
    await manager.ingestFiles("shared_src", [{ name: "inv.csv", data: V1 }]);

    // 缓存实例同一性
    const gateway = manager.gateway!;
    expect(gateway.getCacheManager()).toBe(manager.getQueryCache!());

    // 经 gateway 路径查询（走共享守卫管线）
    const q1 = await gateway.executeQuery({
      sourceId: "shared_src",
      sql: "SELECT stock FROM inv WHERE sku = 'A'",
      bypassExplain: true,
    });
    expect(q1.rows).toEqual([{ stock: 50 }]);
    expect(q1.cacheHit).toBe(false);

    // 再次查询命中共享缓存
    const q2 = await gateway.executeQuery({
      sourceId: "shared_src",
      sql: "SELECT stock FROM inv WHERE sku = 'A'",
      bypassExplain: true,
    });
    expect(q2.cacheHit).toBe(true);

    // 灌库后失效对 gateway 路径生效：读到新数据
    const V2 = Buffer.from("sku,stock\nA,999\n", "utf-8");
    await manager.ingestFiles("shared_src", [{ name: "inv.csv", data: V2 }]);

    const q3 = await gateway.executeQuery({
      sourceId: "shared_src",
      sql: "SELECT stock FROM inv WHERE sku = 'A'",
      bypassExplain: true,
    });
    expect(q3.cacheHit).toBe(false);
    expect(q3.rows).toEqual([{ stock: 999 }]);
  });

  it("describeTableResource 拒绝非法表名标识符", async () => {
    const manager = createDatasourceManager({ configPath, filesDir });
    await expect(
      manager.gateway!.describeTableResource("x", "t; DROP TABLE users --")
    ).rejects.toThrow(/非法表名/);
  });
});
