import { tool, jsonSchema, type CoreTool } from "ai";
import type { DatasourceToolBinding } from "../manager";

/**
 * WS-5 工具输出截断上限:结果序列化字节数超限时以信封形式头尾保留,
 * 缺省 32KB,env LLM_TOOL_OUTPUT_MAX_BYTES 可调(钳 4KB–1MB)。
 * 低于上限的结果原样透传(不改变既有形状,消费方无感知)。
 */
const TOOL_OUTPUT_MAX_BYTES_DEFAULT = 32 * 1024;

function resolveToolOutputMaxBytes(): number {
  const env = Number(process.env.LLM_TOOL_OUTPUT_MAX_BYTES);
  return Number.isFinite(env) && env >= 4096 && env <= 1_000_000
    ? env
    : TOOL_OUTPUT_MAX_BYTES_DEFAULT;
}

/**
 * WS-5 超长结果信封化:头 70% + 尾 20% 保留,中段以截断说明替代,
 * 外层 <tool_output> 标注来源与 untrusted 属性(prompt 侧配套「数据非指令」规则)。
 * 结构化结果仅在超限时才转信封——常规结果形状不变,UI 解析不受影响。
 */
function envelopeOversizeResult(
  sourceId: string,
  originalName: string,
  result: unknown,
  maxBytes: number
): unknown {
  let text: string;
  if (typeof result === "string") {
    text = result;
  } else {
    try {
      text = JSON.stringify(result) ?? "";
    } catch {
      return result; // 病态结果(circular 等)原样放行,不阻塞
    }
  }
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes <= maxBytes) return result;

  const head = text.slice(0, Math.floor(maxBytes * 0.7));
  const tail = text.slice(-Math.floor(maxBytes * 0.2));
  const note = `\n…(结果共 ${bytes} 字节,超上限 ${maxBytes}，已截断；请用更窄的过滤/分页参数重新取数，不要基于截断数据下结论)\n`;
  return {
    output: `<tool_output source="${sourceId}" tool="${originalName}" untrusted="true">\n${head}${note}${tail}\n</tool_output>`,
    isError: false,
    truncated: true,
    originalBytes: bytes,
  };
}

/**
 * 可选适配器：把 SDK 无关的工具绑定包装为 Vercel AI SDK CoreTool。
 * 工具定义以 MCP Server 为唯一事实来源；注册名已带 `<id>_` 前缀（manager 侧完成）。
 * WS-5:结果超限时信封化截断(头尾保留 + 来源标注 + untrusted 标记)。
 */
export function toAiTools(
  bindings: DatasourceToolBinding[],
  opts?: { sourceId?: string; maxOutputBytes?: number }
): Record<string, CoreTool> {
  const aiTools: Record<string, CoreTool> = {};
  const maxBytes = opts?.maxOutputBytes ?? resolveToolOutputMaxBytes();
  for (const binding of bindings) {
    aiTools[binding.name] = tool({
      description: binding.description || binding.originalName,
      parameters: jsonSchema<Record<string, unknown>>(
        (binding.inputSchema as Record<string, unknown>) || {
          type: "object",
        }
      ),
      execute: async (args) => {
        try {
          const result = await binding.call(args as Record<string, unknown>);
          return envelopeOversizeResult(
            opts?.sourceId ?? binding.name.split("_")[0] ?? "unknown",
            binding.originalName,
            result,
            maxBytes
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: message, isError: true };
        }
      },
    });
  }
  return aiTools;
}
