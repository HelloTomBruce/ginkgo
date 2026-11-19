import { createParser } from "@openuidev/lang-core";
import { serverLibrary } from "../serverLibrary";
import type { StructureValidator, ValidationResult } from "@openui-analytics/harness-core";

const parser = createParser(serverLibrary.toJSONSchema(), "Root");

/**
 * OpenUI DSL 看板代码块语法验证器：
 * 预检 ```openui 代码块是否符合 serverLibrary AST Schema 规范
 */
export class OpenUIDslValidator implements StructureValidator<unknown> {
  readonly name = "OpenUIDslValidator";

  validate(content: string): ValidationResult<unknown> {
    if (!content || !content.includes("```openui")) {
      return { ok: true, errors: [] };
    }

    const blockRe = /```openui\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    const errors: string[] = [];
    let parsedCount = 0;

    while ((match = blockRe.exec(content)) !== null) {
      const code = match[1].trim();
      if (!code) continue;
      parsedCount++;

      try {
        const result = parser.parse(code);
        if (result.meta?.errors && result.meta.errors.length > 0) {
          for (const err of result.meta.errors) {
            errors.push(typeof err === "string" ? err : JSON.stringify(err));
          }
        }
        if (!result.root) {
          errors.push("未解析出合法的 Root 根节点");
        }
      } catch (err) {
        errors.push(`DSL 解析异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (parsedCount > 0 && errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true, errors: [] };
  }

  buildFixPrompt(content: string, errors: string[]): string {
    return [
      "The generated ```openui code block has syntax errors preventing it from rendering:",
      ...errors.map((e) => `- ${e}`),
      "",
      "Please fix the syntax strictly. Ensure that:",
      "1. All parenthesis, brackets, and quotes are properly closed.",
      "2. Only valid components and props defined in the library schema are used.",
      "3. The code block starts with ```openui and ends with ```.",
      "Output ONLY the corrected markdown text with the fixed ```openui code block.",
    ].join("\n");
  }
}
