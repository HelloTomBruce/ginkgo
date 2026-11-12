import { describe, it, expect } from "vitest";
import {
  buildSchemaCard,
  buildMcpToolCard,
  renderCardForPrompt,
  scoreTableRelevance,
  collectSchemaCard,
  normalizeCellValue,
  CARD_RENDER_BUDGET_BYTES,
  CARD_STORE_MAX_BYTES,
  LOW_CARDINALITY_THRESHOLD,
  TOP_VALUES_MAX,
  PROFILE_MAX_COLUMNS,
  type RawTableProfile,
  type SchemaProbe,
} from "./card";

const QUOTE = (n: string) => `"${n}"`;

function makeProfile(overrides?: Partial<RawTableProfile>): RawTableProfile {
  return {
    name: "orders",
    rowCount: 123456,
    columns: [
      { column: "status", type: "text" },
      { column: "amount", type: "numeric" },
      { column: "created_at", type: "timestamptz" },
      { column: "note", type: "text" },
    ],
    cardinalities: { status: 5, amount: 9000, note: 100000 },
    ranges: {
      amount: { min: "1", max: "9999" },
      created_at: { min: "2024-01-01", max: "2026-10-30" },
      // 文本列的值域应被忽略（即使采集侧误传）
      note: { min: "a", max: "z" },
    },
    topValues: { status: ["paid", "shipped"] },
    ...overrides,
  };
}

describe("buildSchemaCard 纯函数", () => {
  it("低基数列记 cardinality+topValues；数值/日期列记 min/max；文本列忽略值域", () => {
    const card = buildSchemaCard({
      sourceId: "pg1",
      profiles: [makeProfile()],
      generatedAt: 1000,
    });
    const table = card.tables[0];
    expect(card.kind).toBe("db-like");
    expect(card.truncated).toBe(false);
    expect(table.rowCount).toBe(123456);

    const status = table.columns.find((c) => c.name === "status")!;
    expect(status.cardinality).toBe(5);
    expect(status.topValues).toEqual(["paid", "shipped"]);

    // 高基数列不记 cardinality/topValues
    const note = table.columns.find((c) => c.name === "note")!;
    expect(note.cardinality).toBeUndefined();
    expect(note.topValues).toBeUndefined();
    expect(note.min).toBeUndefined(); // 文本列值域被忽略

    const amount = table.columns.find((c) => c.name === "amount")!;
    expect(amount.min).toBe("1");
    expect(amount.max).toBe("9999");

    const createdAt = table.columns.find((c) => c.name === "created_at")!;
    expect(createdAt.min).toBe("2024-01-01");
  });

  it("预算截断：列数 > PROFILE_MAX_COLUMNS 标 truncated", () => {
    const wideCols = Array.from({ length: PROFILE_MAX_COLUMNS + 5 }, (_, i) => ({
      column: `c${i}`,
      type: "int",
    }));
    const card = buildSchemaCard({
      sourceId: "pg1",
      profiles: [makeProfile({ columns: wideCols })],
    });
    expect(card.truncated).toBe(true);
    expect(card.tables[0].columns).toHaveLength(PROFILE_MAX_COLUMNS);
  });

  it("落盘 64KB 预算失守时去 topValues/截尾表直至达标", () => {
    const huge = Array.from({ length: 200 }, (_, i) =>
      makeProfile({
        name: `t${i}_${"x".repeat(80)}`,
        columns: Array.from({ length: PROFILE_MAX_COLUMNS }, (_, j) => ({
          column: `col_${j}_${"y".repeat(40)}`,
          type: "text",
        })),
        cardinalities: Object.fromEntries(
          Array.from({ length: PROFILE_MAX_COLUMNS }, (_, j) => [
            `col_${j}_${"y".repeat(40)}`,
            3,
          ])
        ),
        topValues: Object.fromEntries(
          Array.from({ length: PROFILE_MAX_COLUMNS }, (_, j) => [
            `col_${j}_${"y".repeat(40)}`,
            Array.from({ length: TOP_VALUES_MAX }, (_, k) => `v${k}_${"z".repeat(30)}`),
          ])
        ),
      })
    );
    const card = buildSchemaCard({ sourceId: "big", profiles: huge });
    expect(card.truncated).toBe(true);
    expect(JSON.stringify(card).length).toBeLessThanOrEqual(CARD_STORE_MAX_BYTES);
  });
});

describe("buildMcpToolCard", () => {
  it("仅工具摘要，超 30 截断", () => {
    const card = buildMcpToolCard({
      sourceId: "gl",
      tools: [
        { name: "gitlab_list", description: "列项目" },
        ...Array.from({ length: 35 }, (_, i) => ({ name: `t${i}` })),
      ],
      generatedAt: 5,
    });
    expect(card.kind).toBe("mcp");
    expect(card.tables).toEqual([]);
    expect(card.toolSummaries).toHaveLength(30);
    expect(card.truncated).toBe(true);
  });
});

describe("renderCardForPrompt", () => {
  it("db-like 渲染含表名/行数/低基数取值/值域；行数降序", () => {
    const small = makeProfile({ name: "dim", rowCount: 10 });
    const card = buildSchemaCard({
      sourceId: "pg1",
      profiles: [makeProfile(), small],
      generatedAt: 1761811200000,
    });
    const out = renderCardForPrompt(card);
    expect(out).toContain("数据源 pg1 结构卡");
    expect(out).toContain("orders（约 123,456 行）");
    expect(out).toContain("status text(5 值: paid/shipped)");
    expect(out).toContain("amount numeric[1 ~ 9999]");
    // 行数降序：orders 在 dim 前
    expect(out.indexOf("orders")).toBeLessThan(out.indexOf("- dim"));
  });

  it("超预算逐行截断至 ≤2KB 并标注", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeProfile({ name: `table_${i}` })
    );
    const card = buildSchemaCard({ sourceId: "pg1", profiles: many });
    const out = renderCardForPrompt(card);
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(
      CARD_RENDER_BUDGET_BYTES
    );
    expect(out).toContain("已按预算截断");
  });

  it("mcp 卡渲染工具清单", () => {
    const card = buildMcpToolCard({
      sourceId: "gl",
      tools: [{ name: "gitlab_list_projects", description: "列出项目" }],
    });
    const out = renderCardForPrompt(card);
    expect(out).toContain("数据源 gl 工具卡");
    expect(out).toContain("gitlab_list_projects：列出项目");
  });
});

describe("normalizeCellValue", () => {
  it("BigInt → string；Date → ISO；null → 空串", () => {
    expect(normalizeCellValue(BigInt("9007199254740993"))).toBe(
      "9007199254740993"
    );
    expect(normalizeCellValue(new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(normalizeCellValue(null)).toBe("");
    expect(normalizeCellValue(42)).toBe("42");
  });
});

describe("collectSchemaCard（假探针）", () => {
  it("两遍查询：聚合 + 低基数 topValues；单表失败跳过", async () => {
    const queries: string[] = [];
    const probe: SchemaProbe = {
      listTables: async () => [{ table: "orders" }, { table: "broken" }],
      describeTable: async (table) => {
        if (table === "broken") throw new Error("describe failed");
        return [
          { column: "status", type: "text" },
          { column: "amount", type: "numeric" },
        ];
      },
      query: async (sql) => {
        queries.push(sql);
        if (sql.includes("COUNT(DISTINCT")) {
          return [{ rowCount: 1000, card_0: 3, card_1: 500, min_1: 1, max_1: 99 }];
        }
        // topValues 查询
        return [
          { v: "paid", c: 600 },
          { v: "shipped", c: 400 },
        ];
      },
    };

    const card = await collectSchemaCard({
      sourceId: "pg1",
      probe,
      quoteIdent: QUOTE,
    });
    // broken 表被跳过，orders 正常
    expect(card.tables).toHaveLength(1);
    const t = card.tables[0];
    expect(t.rowCount).toBe(1000);
    expect(t.columns.find((c) => c.name === "status")?.topValues).toEqual([
      "paid",
      "shipped",
    ]);
    expect(t.columns.find((c) => c.name === "amount")?.min).toBe("1");
    // 高基数列（amount, 500）不发 topValues 查询：仅 1 条 GROUP BY
    expect(queries.filter((q) => q.includes("GROUP BY"))).toHaveLength(1);
    // 标识符被引用
    expect(queries[0]).toContain('"orders"');
  });

  it("mysql 反引号引用策略由调用方注入", async () => {
    const probe: SchemaProbe = {
      listTables: async () => [{ table: "t" }],
      describeTable: async () => [{ column: "c", type: "int" }],
      query: async () => [{ rowCount: 1, card_0: 1, min_0: 0, max_0: 1 }],
    };
    let seen = "";
    const spy: SchemaProbe = {
      ...probe,
      query: async (sql) => {
        seen = sql;
        return probe.query(sql);
      },
    };
    await collectSchemaCard({
      sourceId: "my",
      probe: spy,
      quoteIdent: (n) => `\`${n}\``,
    });
    expect(seen).toContain("`t`");
    expect(seen).toContain("`c`");
  });

  it("超过低基数阈值（LOW_CARDINALITY_THRESHOLD）不记 topValues", async () => {
    const card = buildSchemaCard({
      sourceId: "pg1",
      profiles: [
        makeProfile({
          cardinalities: { status: LOW_CARDINALITY_THRESHOLD + 1 },
        }),
      ],
    });
    const status = card.tables[0].columns.find((c) => c.name === "status")!;
    expect(status.cardinality).toBeUndefined();
  });

  it("scoreTableRelevance 相关度评分：命中表名与字段名得高分", () => {
    const tableOrders = makeProfile({ name: "orders" });
    const tableUsers = makeProfile({
      name: "users",
      columns: [{ column: "email", type: "text" }, { column: "username", type: "text" }],
    });
    const cardOrders = buildSchemaCard({ sourceId: "pg", profiles: [tableOrders] }).tables[0];
    const cardUsers = buildSchemaCard({ sourceId: "pg", profiles: [tableUsers] }).tables[0];

    const scoreForOrders = scoreTableRelevance(cardOrders, "查询近30天订单总金额 orders");
    const scoreForUsers = scoreTableRelevance(cardUsers, "查询近30天订单总金额 orders");
    expect(scoreForOrders).toBeGreaterThan(scoreForUsers);

    // 纯中文提问命中英文 orders 表（同义词：订单 -> orders）
    const scorePureChinese = scoreTableRelevance(cardOrders, "分析本月退款与成单总金额");
    expect(scorePureChinese).toBeGreaterThan(0);

    const scoreEmail = scoreTableRelevance(cardUsers, "用户 email 统计");
    expect(scoreEmail).toBeGreaterThan(0);
  });

  it("renderCardForPrompt 支持 queryHint 优先重排核心表，并包含全库 L1 其余表清单", () => {
    const table1 = makeProfile({ name: "audit_logs", rowCount: 1000000 });
    const table2 = makeProfile({ name: "leads", rowCount: 50 });
    const card = buildSchemaCard({
      sourceId: "pg1",
      profiles: [table1, table2],
      allTables: ["audit_logs", "leads", "customers", "invoices", "payments"],
    });

    // 默认（无 queryHint）：按行数降序，audit_logs 在前
    const defaultOut = renderCardForPrompt(card);
    const auditIdx = defaultOut.indexOf("audit_logs");
    const leadsIdx = defaultOut.indexOf("leads");
    expect(auditIdx).toBeLessThan(leadsIdx);
    expect(defaultOut).toContain("其余可用数据表清单");
    expect(defaultOut).toContain("customers");

    // 带 queryHint（提问与 leads 渠道相关）：leads 获得更高相关度排到首位
    const relevantOut = renderCardForPrompt(card, { queryHint: "分析各个渠道 leads 转化率" });
    const relAuditIdx = relevantOut.indexOf("audit_logs");
    const relLeadsIdx = relevantOut.indexOf("leads");
    expect(relLeadsIdx).toBeLessThan(relAuditIdx);
  });
});
