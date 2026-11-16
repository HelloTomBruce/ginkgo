// @vitest-environment node
/**
 * WS-6 Tier B:真实模型行为评估(手动/夜间,需要真实 API Key)。
 *
 * 运行方式:在环境变量提供 OPENAI_API_KEY(/ LLM_API_KEY)后执行
 *   pnpm --filter @openui-analytics/llm exec vitest run src/evals/tier-b.real-model.test.ts
 * 无 Key 时整组自动跳过(CI 默认不跑)。
 *
 * 固定夹具:文件数据源(CSV→DuckDB)加载确定性渠道营销数据,问题集固定,
 * 轨迹(步数/token/终态/看板解析结果)落盘 src/evals/baselines/tier-b-baseline.json;
 * 与既有基线的差异仅打印对比(人工审阅),硬断言只锁结构成功:
 * 每个问题必须产出能通过 serverLibrary schema 解析的 ```openui 看板。
 *
 * 用途:prompt/模型任何变更前后各跑一次,对比任务成功率与成本漂移。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalyzeHandler } from "../handler";
import { serverLibrary } from "../serverLibrary";
import { createParser } from "@openuidev/lang-core";
import { createDatasourceManager, type DatasourceManager } from "@openui-analytics/datasources";
import type { HarnessEvent, TelemetrySink } from "../telemetry";

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
        const evalHandler = createAnalyzeHandler({ datasources: manager, telemetry: sink });

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

        const blockMatch = report.match(/```openui\n([\s\S]*?)```/);
        const hasDashboardBlock = Boolean(blockMatch);
        let dashboardParsed = false;
        let dashboardParseErrors: string[] = ["未产出 ```openui 看板代码块"];
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

        // 基线落盘 + 差异打印(人工审阅;不做硬断言,避免模型正常波动卡 CI)
        const baselineDir = path.join(path.dirname(new URL(import.meta.url).pathname), "baselines");
        fs.mkdirSync(baselineDir, { recursive: true });
        const baselinePath = path.join(baselineDir, "tier-b-baseline.json");
        const model = process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
        type BaselineEntry = {
          model: string;
          evaluatedAt: string;
          question: string;
          metric: TrajectoryMetric;
        };
        const entry: BaselineEntry = { model, evaluatedAt: new Date().toISOString(), question, metric };
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
      }
    );
  }
});
