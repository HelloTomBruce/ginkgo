// @vitest-environment node
/**
 * WS-6 Tier B:真实模型行为评估(手动/夜间,需要真实 API Key)。
 *
 * 运行方式:在环境变量提供 OPENAI_API_KEY(/ LLM_API_KEY)后执行
 *   pnpm --filter @ginkgo/app-analytics exec vitest run src/evals/tier-b.real-model.test.ts
 * 无 Key 时整组自动跳过(CI 默认不跑)。
 *
 * 固定夹具:文件数据源(CSV→DuckDB)加载确定性渠道营销数据,问题集固定,
 * 轨迹(步数/token/终态/看板解析结果)落盘 src/evals/baselines/tier-b-baseline.json;
 * 与既有基线的差异仅打印对比(人工审阅),硬断言只锁结构成功:
 * 每个问题必须产出能通过 serverLibrary schema 解析的 ```ginkgo 看板。
 *
 * 用途:prompt/模型任何变更前后各跑一次,对比任务成功率与成本漂移。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalyzeHandler } from "@ginkgo/llm";
import { serverLibrary, createParser } from "@ginkgo/components/server";
import {
  createAnalyticsServer,
  analyticsDeliverable,
  analyticsNoApiKeyMessage,
  buildAnalyticsSummaryPrompt,
} from "../server";
import { createDatasourceManager, type DatasourceManager } from "@ginkgo/datasources";
import type { HarnessEvent, TelemetrySink } from "@ginkgo/harness-core";

const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);

/** 确定性夹具:3 渠道 × 3 月,数据量小但足以支撑聚合/趋势/CAC 类问题 */
const FIXTURE_CSV = [
  "month,channel,spend,leads,deals,revenue",
  "2025-01,搜索广告,12000,300,36,108000",
  "2025-01,信息流,8000,260,18,54000",
  "2025-01,线下活动,5000,40,8,40000",
  "2025-02,搜索广告,13000,320,40,124000",
  "2025-02,信息流,9000,280,20,60000",
  "2025-02,线下活动,4500,35,6,30000",
  "2025-03,搜索广告,12500,310,38,118000",
  "2025-03,信息流,11000,300,22,66000",
  "2025-03,线下活动,6000,45,9,45000",
].join("\n");

const QUESTIONS = [
  "各渠道的获客成本(CAC = spend/deals)分别是多少?按 CAC 从低到高排序,给出对比表格与柱状图",
  "2025 年一季度整体收入按月的趋势如何?给出趋势折线图与关键结论",
];

interface TrajectoryMetric {
  question: string;
  passed: boolean;
  steps: number;
  toolCalls: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  termination?: string;
  status?: string;
  durationMs?: number;
  dashboardParsed: boolean;
  dashboardParseErrors: string[];
  hasDashboardBlock: boolean;
}

async function makeFixtureManager(): Promise<DatasourceManager> {
  const configPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tier-b-eval-")),
    "datasources.json"
  );
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      sources: [{ id: "fixture", name: "市场渠道样例", kind: "file", enabled: true }],
    })
  );
  const manager = createDatasourceManager({ configPath });
  await manager.ingestFiles("fixture", [
    { name: "marketing.csv", data: Buffer.from(FIXTURE_CSV, "utf-8") },
  ]);
  return manager;
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3006/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 从 Data Stream 文本中提取 0: 文本分块拼接(报告正文) */
function extractText(dataStreamText: string): string {
  const parts: string[] = [];
  for (const line of dataStreamText.split("\n")) {
    if (!line.startsWith("0:")) continue;
    try {
      parts.push(JSON.parse(line.slice(2)) as string);
    } catch {
      // 非文本分块忽略
    }
  }
  return parts.join("");
}

describe.skipIf(!hasApiKey)("Tier B 真实模型行为评估(需 OPENAI_API_KEY)", () => {
  const parser = createParser(serverLibrary.toJSONSchema(), "Root");
  let manager: DatasourceManager;
  /** WS-13 常态化:按模型分文件落盘,run 级汇总与既有基线硬阈值对比(合规率降 >5pt 拦截) */
  const modelName = process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  const safeModel = modelName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const baselineDir = path.join(path.dirname(new URL(import.meta.url).pathname), "baselines");
  const runMetrics: TrajectoryMetric[] = [];

  it("夹具装载", { timeout: 120_000 }, async () => {
    manager = await makeFixtureManager();
    const manifest = await manager.filesManifest("fixture");
    expect(manifest).not.toBeNull();
  });

  for (const question of QUESTIONS) {
    it(
      `问题评估:${question.slice(0, 18)}…`,
      { timeout: 300_000 },
      async () => {
        const events: HarnessEvent[] = [];
        const sink: TelemetrySink = { emit: (e) => events.push(e) };
        // 与宿主组合根同构装配：analytics 深度编排经应用工厂注入编排层
        const analyticsServer = createAnalyticsServer({ datasources: manager });
        const evalHandler = createAnalyzeHandler({
          defaultAppId: "analytics",
          deliverable: analyticsDeliverable,
          noApiKeyMessage: analyticsNoApiKeyMessage,
          summaryPromptBuilder: buildAnalyticsSummaryPrompt,
          resolveAppPrompt: (appId, ctx) => analyticsServer.buildSystemPrompt(ctx),
          resolveAppTools: (appId, ctx) => analyticsServer.getTools(ctx),
          onTaskFinish: (event) => analyticsServer.onTaskFinish(event),
          telemetry: sink,
        });

        const res = await evalHandler(
          makeRequest({
            messages: [{ role: "user", content: question }],
            apiKey: process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY,
            sessionId: `tierb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            sources: ["fixture"],
            mode: "direct",
            maxSteps: 12,
          })
        );
        const raw = await res.text();
        const report = extractText(raw);

        const stepEvents = events.filter((e) => e.type === "step_finish");
        const toolEvents = events.filter((e) => e.type === "tool_result");
        const finish = events.find((e) => e.type === "task_finish") as
          | Extract<HarnessEvent, { type: "task_finish" }>
          | undefined;

        const blockMatch = report.match(/```ginkgo\n([\s\S]*?)```/);
        const hasDashboardBlock = Boolean(blockMatch);
        let dashboardParsed = false;
        let dashboardParseErrors: string[] = ["未产出 ```ginkgo 看板代码块"];
        if (blockMatch) {
          const parsed = parser.parse(blockMatch[1]);
          dashboardParsed = parsed.root !== null && parsed.meta.errors.length === 0;
          dashboardParseErrors = parsed.meta.errors.map((e) => String(e));
        }

        const metric: TrajectoryMetric = {
          question,
          passed: hasDashboardBlock && dashboardParsed,
          steps: stepEvents.length,
          toolCalls: toolEvents.length,
          totalPromptTokens: finish?.totalPromptTokens,
          totalCompletionTokens: finish?.totalCompletionTokens,
          termination: finish?.termination,
          status: finish?.status,
          durationMs: finish?.durationMs,
          hasDashboardBlock,
          dashboardParsed,
          dashboardParseErrors,
        };

        // 结构硬断言:看板产出且通过 schema 解析
        expect(metric.hasDashboardBlock, `问题未产出看板块:${report.slice(0, 300)}`).toBe(true);
        expect(metric.dashboardParsed, `看板解析失败:${JSON.stringify(dashboardParseErrors)}`).toBe(
          true
        );

        // 基线落盘 + 差异打印(人工审阅;硬阈值在 run 级汇总用例统一判定,避免单题波动卡 CI)
        fs.mkdirSync(baselineDir, { recursive: true });
        const baselinePath = path.join(baselineDir, `${safeModel}.json`);
        type BaselineEntry = {
          model: string;
          evaluatedAt: string;
          question: string;
          metric: TrajectoryMetric;
        };
        const entry: BaselineEntry = { model: modelName, evaluatedAt: new Date().toISOString(), question, metric };
        let history: BaselineEntry[] = [];
        if (fs.existsSync(baselinePath)) {
          try {
            history = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as BaselineEntry[];
          } catch {
            history = [];
          }
        }
        const prev = [...history]
          .reverse()
          .find((h) => h.question === question && h.metric.passed);
        if (prev) {
          const stepDelta = metric.steps - prev.metric.steps;
          const tokenDelta =
            metric.totalPromptTokens && prev.metric.totalPromptTokens
              ? metric.totalPromptTokens - prev.metric.totalPromptTokens
              : null;
          console.log(
            `[Tier B 基线对比] "${question.slice(0, 18)}…" 步数 ${prev.metric.steps}→${metric.steps}(${stepDelta >= 0 ? "+" : ""}${stepDelta})` +
              (tokenDelta !== null ? ` promptTokens ${prev.metric.totalPromptTokens}→${metric.totalPromptTokens}(${tokenDelta >= 0 ? "+" : ""}${tokenDelta})` : "")
          );
        }
        history.push(entry);
        fs.writeFileSync(baselinePath, JSON.stringify(history, null, 2));
        runMetrics.push(metric);
      }
    );
  }

  // WS-13 常态化:run 级汇总(在全部问题用例之后执行)——合规率与成本预算硬阈值
  it(
    "基线对比与预算闸门",
    { timeout: 30_000 },
    () => {
      expect(runMetrics.length).toBeGreaterThan(0);
      const passRate = runMetrics.filter((m) => m.passed).length / runMetrics.length;
      const totalTokens = runMetrics.reduce(
        (sum, m) => sum + (m.totalPromptTokens ?? 0) + (m.totalCompletionTokens ?? 0),
        0
      );
      const budget = Number(process.env.LLM_TIER_B_BUDGET);
      const prevSummaryPath = path.join(baselineDir, `${safeModel}-summary.json`);
      let prevSummary: { passRate: number; evaluatedAt: string } | undefined;
      if (fs.existsSync(prevSummaryPath)) {
        try {
          prevSummary = JSON.parse(fs.readFileSync(prevSummaryPath, "utf-8")) as {
            passRate: number;
            evaluatedAt: string;
          };
        } catch {
          prevSummary = undefined;
        }
      }

      if (prevSummary) {
        const drop = prevSummary.passRate - passRate;
        console.log(
          `[Tier B 汇总] 合规率 ${prevSummary.passRate.toFixed(3)}→${passRate.toFixed(3)}(降 ${drop.toFixed(3)}),总 token ${totalTokens}`
        );
        expect(
          drop,
          `终态合规率较基线下降 ${(drop * 100).toFixed(1)}pt(阈值 5pt):${prevSummary.evaluatedAt} → 本轮。若为模型正常波动请人工更新基线。`
        ).toBeLessThanOrEqual(0.05);
      }
      if (Number.isFinite(budget) && budget > 0) {
        expect(
          totalTokens,
          `本轮总 token ${totalTokens} 超出 LLM_TIER_B_BUDGET=${budget}:评测成本失控,请检查模型/步数配置`
        ).toBeLessThanOrEqual(budget);
      }

      fs.mkdirSync(baselineDir, { recursive: true });
      fs.writeFileSync(
        prevSummaryPath,
        JSON.stringify(
          { model: modelName, evaluatedAt: new Date().toISOString(), passRate, totalTokens },
          null,
          2
        )
      );
    }
  );
});
