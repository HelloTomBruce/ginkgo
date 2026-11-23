import { tool, jsonSchema, type CoreTool } from "ai";
import { z } from "zod";

/**
 * zod 工具定义适配（ai@4.3.x + zod@4 兼容缺口）：
 *
 * ai@4.3 的 asSchema 对 zod@4（standard schema）做 JSON Schema 转换时会丢失
 * 参数结构——发给模型的工具定义只剩 `{"$schema": ...}`，模型看不到任何参数
 * （properties/required 全空），必然乱传参数，在服务端 zod 校验处大量失败。
 *
 * 本 helper 保持 zod schema 为单一事实来源，两端各取所需：
 * - 模型侧：zod@4 内置 z.toJSONSchema（draft-7，io=input）生成完整参数定义；
 * - 校验侧：execute 首行用原 zod schema safeParse，失败返回结构化错误反馈
 *   （{ error, isError } —— 与 MCP 适配器 / 数据源 toAiTools 的约定一致），
 *   模型据此自我纠正，不进入流级 repair/报错路径。
 */
export function zodTool<
  Args extends z.ZodObject<z.ZodRawShape>,
>(def: {
  description: string;
  parameters: Args;
  execute: (args: z.output<Args>) => Promise<unknown>;
}): CoreTool {
  // toJSONSchema 对个别无法映射的类型（z.date 等待 unbounded 大数/未知类型）会抛错：
  // 回退为宽松 object 定义（模型至少拿到工具名与描述，校验仍由 zod 兜底）
  let modelSchema: Record<string, unknown>;
  try {
    modelSchema = z.toJSONSchema(def.parameters, {
      target: "draft-7",
      io: "input",
    }) as Record<string, unknown>;
  } catch {
    modelSchema = { type: "object" };
  }

  return tool({
    description: def.description,
    // jsonSchema() 不带 validate = 模型侧宽松入口：类型小错的参数直达 execute，
    // 由下方 zod 校验反馈（而非 parseToolCall 处抛 InvalidToolArgumentsError）
    parameters: jsonSchema<Record<string, unknown>>(modelSchema),
    execute: async (raw: unknown) => {
      const parsed = def.parameters.safeParse(raw);
      if (!parsed.success) {
        return {
          error: `参数校验失败: ${JSON.stringify(
            parsed.error.issues
          )}。请按工具参数定义修正必填项与类型后重新调用。`,
          isError: true,
        };
      }
      return def.execute(parsed.data);
    },
  }) as CoreTool;
}
