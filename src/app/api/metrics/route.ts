import { metrics, POST as analyzePOST } from "../analyze/route";

/**
 * Prometheus 刮擦出口（WS-13）：进程内聚合 sink 的文本导出。
 * 单实例自刷与 Prometheus pull 模型天然多副本兼容（每实例一个 target，
 * 按 instance label 聚合）；多副本优先 OTel push 路径（otelSink + collector）。
 */
export async function GET() {
  // hub running 数是活值（不在事件流里），刮擦时实时补进 gauge
  const running = await analyzePOST.streamHub.runningCount();
  return new Response(metrics.renderPrometheus({ harness_hub_running: running }), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
}
