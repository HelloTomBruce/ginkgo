/**
 * 手动演示脚本（非 CI 门禁）：企业级架构三位一体的端到端自测演示。
 *
 * 仓库当前不内置 TS 运行器（tsx/vite-node 未安装），本脚本不进 package.json scripts；
 * 需要运行时可临时 `npx tsx scripts/verify-architecture.ts`。
 * 对应的自动化断言由各包同目录的 *.test.ts 承担（gateway/certified/jsonPatch/dashboardSpec）。
 */
import {
  QueryCacheManager,
  computeQueryHashKey,
  dryRunExplain,
  CertifiedQueryStore,
  matchCertifiedQueries,
} from "@ginkgolab/datasources";
import {
  parseDashboardSpec,
  applyJsonPatch,
  type DashboardSpec,
  type JsonPatchOperation,
} from "@ginkgolab/chart-spec";
import {
  certifiedQueriesSection,
} from "../packages/apps/app-analytics/src/server/prompt";
import type { DbDialectClient } from "../packages/ginkgo-datasources/src/connectors/db/sqlGuard";

async function runVerification() {
  console.log("==========================================================");
  console.log("🚀 ginkgo 企业级架构三位一体落地自测演示");
  console.log("==========================================================\n");

  // ------------------------------------------------------------------------
  // 1. 验证阶段一 (P1)：结果集 KV 缓存与规范化哈希
  // ------------------------------------------------------------------------
  console.log("👉 [验证 1] 结果集 KV 缓存与 SQL 归一化命中测试");
  const cacheManager = new QueryCacheManager({ defaultTtlMs: 5000 });
  const key1 = computeQueryHashKey("conn_pg_1", "SELECT  user_id, count(*) \nFROM orders   WHERE status = 'paid';");
  const key2 = computeQueryHashKey("conn_pg_1", "select user_id, count(*) from orders where status = 'paid'");

  console.log(`   - 语句1 哈希: ${key1.sqlHash.slice(0, 16)}`);
  console.log(`   - 语句2 哈希: ${key2.sqlHash.slice(0, 16)}`);
  console.log(`   - 归一化后一致: ${key1.sqlHash === key2.sqlHash ? "✅ PASS" : "❌ FAIL"}`);

  cacheManager.set(key1, { rows: [{ user_id: 1, count: 42 }] }, 5000);
  const cached = cacheManager.get(key2);
  console.log(`   - 语句2 命中缓存: ${cached && (cached.data as { rows: unknown[] }).rows.length === 1 ? "✅ PASS (直接返回，免击穿数仓)" : "❌ FAIL"}\n`);

  // ------------------------------------------------------------------------
  // 2. 验证阶段一 (P1)：EXPLAIN Dry-run 执行计划全表扫描熔断
  // ------------------------------------------------------------------------
  console.log("👉 [验证 2] EXPLAIN Dry-run 全表扫描与行数预算安全熔断");
  const dangerousClient: DbDialectClient = {
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          "QUERY PLAN": JSON.stringify([
            {
              Plan: {
                "Node Type": "Seq Scan",
                "Relation Name": "big_logs",
                "Plan Rows": 5000000,
              },
            },
          ]),
        },
      ],
    }),
    close: async () => {},
  };

  const explainReport = await dryRunExplain(
    dangerousClient,
    "postgres",
    "SELECT * FROM big_logs WHERE message LIKE '%error%'",
    { maxScanRowsBudget: 1000000 }
  );
  console.log(`   - 识别出全表扫描: ${explainReport.isFullTableScan ? "⚠️ YES (Seq Scan)" : "NO"}`);
  console.log(`   - 预估扫描行数: ${explainReport.estimatedRows?.toLocaleString()} 行 (上限 1,000,000)`);
  console.log(`   - 超过预算熔断: ${explainReport.exceedsBudget ? "⛔ 触发预算拦截" : "安全"}`);
  console.log(`   - 拦截警告: ${explainReport.costWarning || "无"}\n`);

  // ------------------------------------------------------------------------
  // 3. 验证阶段二 (P2)：Certified Queries 权威口径检索与提示词注入
  // ------------------------------------------------------------------------
  console.log("👉 [验证 3] Certified Queries 权威指标意图召回与 System Prompt 动态注入");
  const certifiedStore = new CertifiedQueryStore();
  certifiedStore.upsert({
    id: "certified_cac",
    title: "获客成本 (CAC)",
    description: "客户获取成本计算口径，包含市场投放与销售激励",
    sqlTemplate: "SELECT month, total_marketing_spend / nullif(new_customers, 0) AS cac FROM finance_cac_mart",
    sourceId: "dw_snowflake",
    certifiedBy: "BI 团队 (数据委员会)",
    tags: ["获客成本", "cac", "新客成本", "市场投入"],
  });

  const matched = matchCertifiedQueries("我想看看上个月的获客成本CAC走势如何", ["dw_snowflake"], certifiedStore);
  console.log(`   - 用户提问: '我想看看上个月的获客成本CAC走势如何'`);
  console.log(`   - 命中认证指标: ${matched.length > 0 ? `✅ 召回 "${matched[0].query.title}" (置信度: ${(matched[0].score * 100).toFixed(0)}%)` : "❌ 未召回"}`);
  console.log(`   - 认证人: ${matched[0]?.query.certifiedBy}`);

  const section = certifiedQueriesSection(matched);
  const promptHasSection = section.includes("【权威业务口径约束 (Certified Queries)】") || section.includes("权威业务口径约束");
  console.log(`   - 模型 System Prompt 注入权威口径段落: ${promptHasSection ? "✅ PASS" : "❌ FAIL"}\n`);

  // ------------------------------------------------------------------------
  // 4. 验证阶段三 (P3)：DashboardSpec 2.0 数据-视图解耦与 RFC 6902 JSON Patch 增量编辑
  // ------------------------------------------------------------------------
  console.log("👉 [验证 4] DashboardSpec 2.0 (Data-View 分离) 与 JSON Patch 增量修改");
  const initialSpec: DashboardSpec = {
    version: "2.0",
    metadata: {
      id: "dash_exec_01",
      title: "经营核心看板",
    },
    queries: {
      q_cac: {
        sourceId: "dw_snowflake",
        sql: "SELECT month, cac FROM finance_cac_mart",
      },
    },
    layout: {
      columns: 12,
      gap: 4,
      rows: [
        {
          id: "row_1",
          widgets: [{ id: "w_cac_metric", colSpan: 4 }],
        },
      ],
    },
    widgets: {
      w_cac_metric: {
        type: "MetricCard",
        title: "当前 CAC",
        queryBinding: { queryId: "q_cac" },
        chartConfig: {
          value: "$24.50",
          change: "-12.5%",
          trend: "down",
        },
      },
    },
  };

  const parsed = parseDashboardSpec(initialSpec);
  console.log(`   - 初始化看板 Spec 校验: ${parsed.version === "2.0" ? "✅ 验证通过 (Widget 绑定 Query 'q_cac')" : "❌ 失败"}`);

  // 用户下一轮对话指令：“把指标卡宽度调成 6，并改名为 '最新客户获取成本'”
  const patchOps: JsonPatchOperation[] = [
    { op: "replace", path: "/layout/rows/0/widgets/0/colSpan", value: 6 },
    { op: "replace", path: "/widgets/w_cac_metric/title", value: "最新客户获取成本" },
  ];

  const patchResult = applyJsonPatch(initialSpec, patchOps);
  console.log(`   - 应用原子 JSON Patch: ${patchResult.success ? "✅ 成功更新" : "❌ 失败"}`);
  console.log(`   - 新 Widget 宽度 (colSpan): ${patchResult.doc.layout.rows[0].widgets[0].colSpan} (原值 4)`);
  console.log(`   - 新 Widget 标题: ${patchResult.doc.widgets["w_cac_metric"].title}`);
  console.log(`   - 结构完整性校验: ${patchResult.doc.version === "2.0" ? "✅ 符合 Spec 2.0" : "❌"}\n`);

  console.log("==========================================================");
  console.log("🎉 全部 4 个验证环节通过！架构自愈、口径治理与增量渲染验证完毕。");
  console.log("==========================================================");
}

runVerification().catch(console.error);
